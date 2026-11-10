import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ApiAppModule } from '../app/api-app.module';
import { ConfigError, loadConfig } from '../core';
import { ACCOUNT_PUBLIC_API, StaffInputError, type AccountPublicApi } from '../modules/account';

// Dữ liệu mẫu xác thực cho máy dev (004, T079, contracts/auth-ops.md mục 3) – `pnpm dev:seed-auth`.
// CHỈ chạy khi APP_ENV ∈ {development, test}. Tạo 1 tài khoản: chủ owner@example.test (đã xác minh)
// + 2 cộng tác viên, 1 nhân viên support và 1 admin. In mật khẩu mẫu đúng một lần; chạy lại an toàn
// (đã có thì bỏ qua, không in lại mật khẩu).

export const SEED_EMAILS = {
  owner: 'owner@example.test',
  collaborators: ['collab1@example.test', 'collab2@example.test'],
  support: 'support@example.test',
  admin: 'admin@example.test',
} as const;

export interface SeedResult {
  created: boolean;
  password?: string;
}

export async function runSeedAuth(env: NodeJS.ProcessEnv = process.env): Promise<SeedResult> {
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
    return { created: true, password };
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
