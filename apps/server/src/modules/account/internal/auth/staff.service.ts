import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  AUTH_CONFIG,
  permissionsOf,
  uuidV7,
  type AuthConfig,
  type Resolved,
  type StaffActor,
  type StaffRole,
} from '../../../../core';
import { cidrMatcher, userAgentSummary } from '../../../../core/auth/client-ip';
import { SessionCache } from '../../../../core/auth/session-cache';
import { authTx } from '../../../../core/db/auth-tx';
import { staffSessions, staffUsers } from '../db/schema';
import { writeAuthAudit } from './audit';
import { normalizeEmail } from './email';
import { invalidCredentials, LoginThrottledError, passwordWeak } from './errors';
import { ipNotAllowed } from '../../../../core/auth/auth-errors';
import { PasswordHasher } from './password/password-hasher';
import { checkPassword, normalizePassword } from './password/password-policy';
import { ThrottleService } from './throttle.service';
import { hashToken, newToken } from './tokens';

// Nhân viên nội bộ (FR-016, US4, R10): bảng dùng chung, mọi truy cập qua authTx. Lối vào riêng
// (/internal/auth, cookie __Host-staff_sid), phiên ngắn, giới hạn theo STAFF_ALLOWED_CIDRS, kiểm toán
// mọi lần đăng nhập. Tạo/khóa/đặt lại mật khẩu bằng lệnh vận hành (`pnpm staff`).

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const STAFF_TOUCH_AFTER_MS = MINUTE_MS;

export interface StaffSummary {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  status: 'active' | 'disabled';
}

export interface StaffMe {
  staff: { id: string; displayName: string; email: string };
  role: StaffRole;
  permissions: ReturnType<typeof permissionsOf>;
}

/** Lỗi đầu vào của lệnh vận hành (mã thoát 1). */
export class StaffInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaffInputError';
  }
}

const OPS_ACTOR = { actorType: 'system', actorId: 'ops-cli' } as const;

@Injectable()
export class StaffService {
  private readonly ipAllowed: (ip: string) => boolean;

  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(SessionCache) private readonly cache: SessionCache,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(ThrottleService) private readonly throttle: ThrottleService,
  ) {
    this.ipAllowed = cidrMatcher(config.staffAllowedCidrs);
  }

  async login(input: {
    email: string;
    password: string;
    ip: string;
    userAgent: string | undefined;
  }): Promise<{ token: string; me: StaffMe }> {
    const uaFamily = userAgentSummary(input.userAgent);
    const emailKey =
      normalizeEmail(input.email)?.emailNormalized ?? input.email.trim().toLowerCase();
    if (!this.ipAllowed(input.ip)) {
      await authTx((db) =>
        writeAuthAudit(db, {
          actorType: 'anonymous',
          actorId: 'anonymous',
          action: 'staff.login.denied_ip',
          ip: input.ip,
          uaFamily,
          reason: 'ip_not_allowed',
        }),
      );
      throw ipNotAllowed();
    }
    // Cùng bộ đếm, cùng ngưỡng với khách hàng; bị chặn thì không kiểm tra mật khẩu.
    const [byEmail, byIp] = await Promise.all([
      this.throttle.check('login_email', `staff:${emailKey}`),
      this.throttle.check('login_ip', input.ip),
    ]);
    if (byEmail.blocked || byIp.blocked) {
      throw new LoginThrottledError(Math.max(byEmail.retryAfterSeconds, byIp.retryAfterSeconds));
    }

    const password = normalizePassword(input.password);
    const staff = await authTx(async (db) => {
      const rows = await db
        .select()
        .from(staffUsers)
        .where(eq(staffUsers.email_normalized, emailKey))
        .limit(1);
      return rows[0];
    });
    const ok =
      staff === undefined
        ? await this.hasher.verifyDummy(password)
        : await this.hasher.verify(staff.password_hash, password);
    if (staff === undefined || !ok || staff.status !== 'active') {
      await Promise.all([
        this.throttle.hit('login_email', `staff:${emailKey}`),
        this.throttle.hit('login_ip', input.ip),
      ]);
      await authTx((db) =>
        writeAuthAudit(db, {
          actorType: staff?.role ?? 'anonymous',
          actorId: staff?.id ?? 'anonymous',
          action: 'staff.login.failed',
          ip: input.ip,
          uaFamily,
          reason: staff === undefined ? 'unknown_email' : !ok ? 'bad_password' : 'staff_disabled',
        }),
      );
      throw invalidCredentials();
    }

    await this.throttle.reset('login_email', `staff:${emailKey}`);
    const token = newToken();
    const now = Date.now();
    await authTx(async (db) => {
      if (this.hasher.needsRehash(staff.password_hash)) {
        await db
          .update(staffUsers)
          .set({ password_hash: await this.hasher.hash(password) })
          .where(eq(staffUsers.id, staff.id));
      }
      await db.insert(staffSessions).values({
        id: uuidV7(),
        staff_user_id: staff.id,
        token_hash: hashToken(token),
        last_seen_at: new Date(now),
        idle_expires_at: new Date(now + this.config.staffSessionIdleMinutes * MINUTE_MS),
        absolute_expires_at: new Date(now + this.config.staffSessionAbsoluteHours * HOUR_MS),
        user_agent_summary: uaFamily,
        assurance: 'password',
        ip: input.ip,
      });
      await writeAuthAudit(db, {
        actorType: staff.role,
        actorId: staff.id,
        action: 'staff.login.succeeded',
        ip: input.ip,
        uaFamily,
      });
    });
    return {
      token,
      me: {
        staff: { id: staff.id, displayName: staff.display_name, email: staff.email_normalized },
        role: staff.role,
        permissions: permissionsOf(staff.role),
      },
    };
  }

  /** Phiên nhân viên còn hiệu lực + nhân viên `active`; cập nhật last_seen_at khi cũ hơn 1 phút. */
  // Dải mạng do AccessGuard kiểm (tham số `ip` của giao diện không cần ở đây).
  async resolveStaff(tokenHash: Buffer): Promise<Resolved<StaffActor> | null> {
    const row = await authTx(async (db) => {
      const rows = await db
        .select({
          sessionId: staffSessions.id,
          staffId: staffUsers.id,
          role: staffUsers.role,
          lastSeen: staffSessions.last_seen_at,
          absolute: staffSessions.absolute_expires_at,
        })
        .from(staffSessions)
        .innerJoin(staffUsers, eq(staffUsers.id, staffSessions.staff_user_id))
        .where(
          and(
            eq(staffSessions.token_hash, tokenHash),
            isNull(staffSessions.revoked_at),
            gt(staffSessions.idle_expires_at, sql`now()`),
            gt(staffSessions.absolute_expires_at, sql`now()`),
            eq(staffUsers.status, 'active'),
          ),
        )
        .limit(1);
      const found = rows[0];
      if (found !== undefined && Date.now() - found.lastSeen.getTime() > STAFF_TOUCH_AFTER_MS) {
        await db
          .update(staffSessions)
          .set({
            last_seen_at: sql`now()`,
            idle_expires_at: sql`now() + ${`${this.config.staffSessionIdleMinutes} minutes`}::interval`,
          })
          .where(eq(staffSessions.id, found.sessionId));
      }
      return found;
    });
    if (row === undefined) return null;
    return {
      actor: { kind: 'staff', staffId: row.staffId, role: row.role, sessionId: row.sessionId },
      absoluteExpiresAt: row.absolute,
    };
  }

  async me(staffId: string): Promise<StaffMe | null> {
    const staff = await authTx(async (db) => {
      const rows = await db.select().from(staffUsers).where(eq(staffUsers.id, staffId)).limit(1);
      return rows[0];
    });
    if (staff === undefined) return null;
    return {
      staff: { id: staff.id, displayName: staff.display_name, email: staff.email_normalized },
      role: staff.role,
      permissions: permissionsOf(staff.role),
    };
  }

  async logout(sessionId: string, tokenHash: Buffer): Promise<void> {
    await authTx(async (db) => {
      await db
        .update(staffSessions)
        .set({ revoked_at: sql`now()`, revoke_reason: 'logout' })
        .where(and(eq(staffSessions.id, sessionId), isNull(staffSessions.revoked_at)));
    });
    this.cache.evict(tokenHash);
  }

  // ----- Lệnh vận hành (actor_type = 'system', actor_id = 'ops-cli') -----

  async create(input: {
    email: string;
    displayName: string;
    role: StaffRole;
    password: string;
  }): Promise<StaffSummary> {
    const email = normalizeEmail(input.email);
    if (email === null) throw new StaffInputError('Email không hợp lệ');
    const name = input.displayName.trim();
    if (name.length < 1 || name.length > 80) throw new StaffInputError('Tên phải dài 1–80 ký tự');
    const checked = checkPassword(input.password, email.emailNormalized);
    if (!checked.ok) throw new StaffInputError(checked.message);
    const passwordHash = await this.hasher.hash(checked.normalized);
    const id = uuidV7();
    try {
      await authTx(async (db) => {
        await db.insert(staffUsers).values({
          id,
          email_normalized: email.emailNormalized,
          display_name: name,
          role: input.role,
          password_hash: passwordHash,
          status: 'active',
        });
        await writeAuthAudit(db, { ...OPS_ACTOR, action: 'staff.created', reason: input.role });
      });
    } catch (err) {
      if ((err as { code?: unknown }).code === '23505') {
        throw new StaffInputError('Email nhân viên đã tồn tại');
      }
      throw err;
    }
    return {
      id,
      email: email.emailNormalized,
      displayName: name,
      role: input.role,
      status: 'active',
    };
  }

  private async findIdByEmail(emailInput: string): Promise<string> {
    const email = normalizeEmail(emailInput);
    if (email === null) throw new StaffInputError('Email không hợp lệ');
    const rows = await authTx((db) =>
      db
        .select({ id: staffUsers.id })
        .from(staffUsers)
        .where(eq(staffUsers.email_normalized, email.emailNormalized))
        .limit(1),
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new StaffInputError('Không tìm thấy nhân viên');
    return id;
  }

  /** Khóa nhân viên và thu hồi mọi phiên (bản API khác từ chối ≤ 60 giây). */
  async disable(emailInput: string): Promise<void> {
    const id = await this.findIdByEmail(emailInput);
    await authTx(async (db) => {
      await db.update(staffUsers).set({ status: 'disabled' }).where(eq(staffUsers.id, id));
      await db
        .update(staffSessions)
        .set({ revoked_at: sql`now()`, revoke_reason: 'staff_disabled' })
        .where(and(eq(staffSessions.staff_user_id, id), isNull(staffSessions.revoked_at)));
      await writeAuthAudit(db, { ...OPS_ACTOR, action: 'staff.disabled' });
    });
    this.cache.evictWhere((a) => a.kind === 'staff' && a.staffId === id);
  }

  /** Đặt mật khẩu mới (áp chính sách) và thu hồi mọi phiên. */
  async resetPassword(emailInput: string, password: string): Promise<void> {
    const email = normalizeEmail(emailInput);
    if (email === null) throw new StaffInputError('Email không hợp lệ');
    const checked = checkPassword(password, email.emailNormalized);
    if (!checked.ok) throw new StaffInputError(checked.message);
    const id = await this.findIdByEmail(emailInput);
    const passwordHash = await this.hasher.hash(checked.normalized);
    await authTx(async (db) => {
      await db
        .update(staffUsers)
        .set({ password_hash: passwordHash, password_changed_at: sql`now()` })
        .where(eq(staffUsers.id, id));
      await db
        .update(staffSessions)
        .set({ revoked_at: sql`now()`, revoke_reason: 'password_reset' })
        .where(and(eq(staffSessions.staff_user_id, id), isNull(staffSessions.revoked_at)));
      await writeAuthAudit(db, { ...OPS_ACTOR, action: 'staff.password_reset' });
    });
    this.cache.evictWhere((a) => a.kind === 'staff' && a.staffId === id);
  }

  /** Danh sách nhân viên – KHÔNG có băm mật khẩu. */
  async list(): Promise<StaffSummary[]> {
    const rows = await authTx((db) =>
      db
        .select({
          id: staffUsers.id,
          email: staffUsers.email_normalized,
          displayName: staffUsers.display_name,
          role: staffUsers.role,
          status: staffUsers.status,
        })
        .from(staffUsers)
        .orderBy(asc(staffUsers.email_normalized)),
    );
    return rows;
  }
}

/** Kiểm mật khẩu mới cho API (lỗi theo ô) – dùng chung chính sách. */
export function assertStrongPassword(
  field: string,
  password: string,
  emailNormalized: string,
): string {
  const checked = checkPassword(password, emailNormalized);
  if (!checked.ok) throw passwordWeak(field, checked.message, checked.reason);
  return checked.normalized;
}
