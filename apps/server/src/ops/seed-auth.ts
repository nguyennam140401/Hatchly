import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ApiAppModule } from '../app/api-app.module';
import { ConfigError, loadConfig } from '../core';
import { ACCOUNT_PUBLIC_API, StaffInputError, type AccountPublicApi } from '../modules/account';

// Dữ liệu mẫu xác thực cho máy dev (004 T079, 009 T087, contracts/auth-ops.md mục 3) – `pnpm dev:seed-auth`.
// CHỈ chạy khi APP_ENV ∈ {development, test}. Tạo 1 tài khoản: chủ owner@example.test (đã xác minh)
// + 1 cộng tác viên + 1 lời mời đang chờ (đủ 2/2 chỗ), 1 người ở tài khoản chờ (đã bị gỡ khỏi tài
// khoản, vào `/no-account`), 1 nhân viên support và 1 admin. In mật khẩu mẫu đúng một lần; chạy lại
// an toàn (đã có thì bỏ qua, không in lại mật khẩu, không tạo lời mời thứ hai).

export const SEED_EMAILS = {
  owner: 'owner@example.test',
  collaborators: ['collab1@example.test'],
  /** Email của lời mời đang chờ – chưa có người dùng; mở liên kết `/join#token=…` để tham gia. */
  invited: 'invited@example.test',
  /** Người đã bị gỡ khỏi tài khoản mẫu: đăng nhập được, ở tài khoản chờ. */
  detached: 'detached@example.test',
  support: 'support@example.test',
  admin: 'admin@example.test',
} as const;

export interface SeedResult {
  created: boolean;
  password?: string;
  /** Mã lời mời mẫu – CHỈ trả khi tạo mới; nơi gọi tự quyết in ra (chỉ ở dev). */
  inviteToken?: string;
}

export async function runSeedAuth(env: NodeJS.ProcessEnv = process.env): Promise<SeedResult> {
  // Kiểm môi trường TRƯỚC khi nạp cấu hình: staging/production bị loadConfig từ chối vì bản giả lập (005)
  // – lệnh chỉ-dev phải báo đúng lý do của nó.
  if (env.APP_ENV !== 'development' && env.APP_ENV !== 'test') {
    throw new Error('dev:seed-auth chỉ chạy khi APP_ENV là development hoặc test');
  }
  const config = loadConfig(env);
  if (config.APP_ENV !== 'development' && config.APP_ENV !== 'test') {
    throw new Error('dev:seed-auth chỉ chạy khi APP_ENV là development hoặc test');
  }
  const app = await NestFactory.createApplicationContext(ApiAppModule.forRoot(config), {
    logger: false,
  });
  try {
    const accounts = app.get<AccountPublicApi>(ACCOUNT_PUBLIC_API);
    // Mật khẩu mẫu ngẫu nhiên mỗi máy (không ghi cố định vào mã nguồn).
    const password = `Mau-${randomBytes(9).toString('base64url')}`;
    const owner = await accounts.createVerifiedOwner({
      displayName: 'Chủ tiệm mẫu',
      email: SEED_EMAILS.owner,
      password,
    });
    if (!owner.created) return { created: false };
    // Người ở tài khoản chờ: thêm làm cộng tác viên rồi gỡ ngay (cùng đường `member_detach` như chủ gỡ
    // thật) – làm TRƯỚC để ghế được trả lại cho cộng tác viên và lời mời bên dưới.
    const leaver = await accounts.addMember({
      accountId: owner.accountId,
      displayName: 'Người đã rời',
      email: SEED_EMAILS.detached,
      password,
      emailVerified: true,
      addedByUserId: owner.userId,
    });
    await accounts.removeMember({
      accountId: owner.accountId,
      userId: leaver.userId,
      byUserId: owner.userId,
    });
    for (const [i, email] of SEED_EMAILS.collaborators.entries()) {
      await accounts.addMember({
        accountId: owner.accountId,
        displayName: `Cộng tác viên ${i + 1}`,
        email,
        password,
        emailVerified: true,
        addedByUserId: owner.userId,
      });
    }
    const invitation = await accounts.createPendingInvitation({
      accountId: owner.accountId,
      invitedByUserId: owner.userId,
      email: SEED_EMAILS.invited,
    });
    for (const role of ['support', 'admin'] as const) {
      try {
        await accounts.createStaff({
          email: SEED_EMAILS[role],
          displayName: role === 'admin' ? 'Quản trị mẫu' : 'Hỗ trợ mẫu',
          role,
          password,
        });
      } catch (err) {
        if (!(err instanceof StaffInputError)) throw err; // đã có → bỏ qua
      }
    }
    return { created: true, password, inviteToken: invitation.token };
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  runSeedAuth().then(
    (result) => {
      if (!result.created) {
        console.log('Dữ liệu mẫu đã có – bỏ qua (mật khẩu không đổi).');
      } else {
        console.log('Đã tạo dữ liệu mẫu. Mật khẩu chung (chỉ in một lần):', result.password);
        console.log(
          `  Khách hàng: ${SEED_EMAILS.owner}, ${SEED_EMAILS.collaborators.join(', ')} → http://localhost:5173/login`,
        );
        console.log(
          `  Người ở tài khoản chờ (đã bị gỡ): ${SEED_EMAILS.detached} → http://localhost:5173/login (vào /no-account)`,
        );
        // Mã lời mời là bí mật dùng một lần: CHỈ in ở máy dev (APP_ENV=development), không in ở test/CI.
        if (process.env.APP_ENV === 'development' && result.inviteToken !== undefined) {
          console.log(
            `  Lời mời đang chờ cho ${SEED_EMAILS.invited} → http://localhost:5173/join#token=${result.inviteToken}`,
          );
        }
        console.log(
          `  Nội bộ: ${SEED_EMAILS.support}, ${SEED_EMAILS.admin} → http://localhost:5173/internal/login`,
        );
      }
      process.exit(0);
    },
    (err: unknown) => {
      console.error(err instanceof ConfigError || err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
