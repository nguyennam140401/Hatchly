import { Inject, Injectable } from '@nestjs/common';
import type { RegisterInput } from '@app/shared/auth';
import { eq, sql } from 'drizzle-orm';
import { AUTH_CONFIG, tenantTx, uuidV7, type AuthConfig } from '../../../../core';
import { runInAccountScope } from '../../../../core/auth/account-scope';
import { authTokens, users } from '../db/schema';
import { userAgentSummary } from '../../../../core/auth/client-ip';
import { authTx } from '../../../../core/db/auth-tx';
import { writeAuthAudit } from './audit';
import { normalizeEmail } from './email';
import { emailInvalid, passwordWeak, rateLimited } from './errors';
import { MailDispatcher } from './mail/dispatch';
import { PasswordHasher } from './password/password-hasher';
import { checkPassword } from './password/password-policy';
import type { RequestMeta } from './session.service';
import { lookupEmail } from './session.service';
import { ThrottleService } from './throttle.service';
import { hashToken, newToken } from './tokens';

// Đăng ký (FR-001…FR-005, FR-008b, R8): tạo nguyên vẹn tài khoản + người dùng + cách đăng nhập + vai
// trò chủ + mã xác minh bằng MỘT lời gọi account.auth_register. Phản hồi GIỐNG HỆT nhau cho email mới
// và email đã có (không cookie, luôn băm mật khẩu để thời gian tương đương) – không lộ email nào đã
// đăng ký. Đăng ký KHÔNG tự đăng nhập: phiên được cấp khi mở liên kết xác minh.

const VERIFY_TTL_MS = 24 * 3_600_000;

@Injectable()
export class RegistrationService {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(ThrottleService) private readonly throttle: ThrottleService,
    @Inject(MailDispatcher) private readonly mail: MailDispatcher,
  ) {}

  async register(input: RegisterInput, meta: RequestMeta): Promise<{ status: 'check_email' }> {
    if (!(await this.throttle.consume('register_ip', meta.ip))) throw rateLimited();
    const email = normalizeEmail(input.email);
    if (email === null) throw emailInvalid();
    const checked = checkPassword(input.password, email.emailNormalized);
    if (!checked.ok) throw passwordWeak('password', checked.message, checked.reason);

    // LUÔN băm – kể cả khi email đã có (cân thời gian).
    const passwordHash = await this.hasher.hash(checked.normalized);
    const token = newToken();
    const ids = {
      account: uuidV7(),
      user: uuidV7(),
      identity: uuidV7(),
      membership: uuidV7(),
      token: uuidV7(),
    };
    const outcome = await authTx(async (db) => {
      const result = await db.execute<{ outcome: 'created' | 'email_taken' }>(sql`
        SELECT account.auth_register(
          ${ids.account}::uuid, ${ids.user}::uuid, ${ids.identity}::uuid, ${ids.membership}::uuid,
          ${ids.token}::uuid, ${input.displayName}, ${email.email}, ${email.emailNormalized},
          ${passwordHash}, ${this.config.termsVersion}, ${hashToken(token)},
          ${new Date(Date.now() + VERIFY_TTL_MS)}::timestamptz
        ) AS outcome`);
      const value = result.rows[0]?.outcome;
      if (value === 'created') {
        await writeAuthAudit(db, {
          actorType: 'user',
          actorId: ids.user,
          accountId: ids.account,
          action: 'auth.register',
          ip: meta.ip,
          uaFamily: userAgentSummary(meta.userAgent),
        });
      }
      return value;
    });

    if (outcome === 'created') {
      this.mail.sendAfterCommit('verifyEmail', email.email, {
        displayName: input.displayName,
        token,
        userId: ids.user,
      });
    } else {
      const existing = await lookupEmail(email.emailNormalized);
      this.mail.sendAfterCommit('emailAlreadyRegistered', email.email, {
        displayName: existing?.display_name,
        userId: existing?.user_id ?? null,
      });
    }
    return { status: 'check_email' };
  }

  /**
   * CHỈ cho dữ liệu mẫu/kiểm thử (pnpm dev:seed-auth): tạo chủ tài khoản đã xác minh email, không gửi
   * thư. Email đã có → trả tài khoản sẵn có (chạy lại an toàn).
   */
  async createVerifiedOwner(input: {
    displayName: string;
    email: string;
    password: string;
  }): Promise<{ accountId: string; userId: string; created: boolean }> {
    const email = normalizeEmail(input.email);
    if (email === null) throw emailInvalid();
    const existing = await lookupEmail(email.emailNormalized);
    if (existing !== undefined) {
      return { accountId: existing.account_id, userId: existing.user_id, created: false };
    }
    const checked = checkPassword(input.password, email.emailNormalized);
    if (!checked.ok) throw passwordWeak('password', checked.message, checked.reason);
    const passwordHash = await this.hasher.hash(checked.normalized);
    const ids = {
      account: uuidV7(),
      user: uuidV7(),
      identity: uuidV7(),
      membership: uuidV7(),
      token: uuidV7(),
    };
    const outcome = await authTx(async (db) => {
      const result = await db.execute<{ outcome: 'created' | 'email_taken' }>(sql`
        SELECT account.auth_register(
          ${ids.account}::uuid, ${ids.user}::uuid, ${ids.identity}::uuid, ${ids.membership}::uuid,
          ${ids.token}::uuid, ${input.displayName}, ${email.email}, ${email.emailNormalized},
          ${passwordHash}, ${this.config.termsVersion}, ${hashToken(newToken())},
          now()::timestamptz
        ) AS outcome`);
      return result.rows[0]?.outcome;
    });
    if (outcome !== 'created') {
      const raced = await lookupEmail(email.emailNormalized);
      if (raced === undefined) throw emailInvalid();
      return { accountId: raced.account_id, userId: raced.user_id, created: false };
    }
    await runInAccountScope(ids.account, () =>
      tenantTx(async (db) => {
        await db
          .update(users)
          .set({ email_verified_at: sql`now()` })
          .where(eq(users.id, ids.user));
        await db
          .update(authTokens)
          .set({ used_at: sql`now()` })
          .where(eq(authTokens.user_id, ids.user));
      }),
    );
    return { accountId: ids.account, userId: ids.user, created: true };
  }
}
