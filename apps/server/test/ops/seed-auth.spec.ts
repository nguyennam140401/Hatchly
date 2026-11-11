import { expect, it } from 'vitest';
import { runSeedAuth, SEED_EMAILS } from '../../src/ops/seed-auth';
import { asOwner, dbUrls, describeDb } from '../db/helpers/db';
import { TEST_AUTH_ENV } from '../helpers/auth-env';

// T079: dữ liệu mẫu xác thực – tạo đủ người, chạy lại an toàn, từ chối ngoài development/test.

const env = {
  APP_ENV: 'test',
  LOG_LEVEL: 'fatal',
  ...TEST_AUTH_ENV,
  DATABASE_APP_URL: dbUrls.app,
  DATABASE_SUPPORT_URL: dbUrls.support,
};

describeDb('pnpm dev:seed-auth', () => {
  it('lần đầu tạo chủ đã xác minh + 2 cộng tác viên + 2 nhân viên; lần hai bỏ qua', async () => {
    const first = await runSeedAuth(env);
    expect(first.created).toBe(true);
    expect(first.password).toMatch(/^Mau-/);
    const second = await runSeedAuth(env);
    expect(second).toEqual({ created: false });

    const rows = await asOwner(async (c) => {
      const users = await c.query<{ email_normalized: string; verified: boolean; role: string }>(
        `SELECT u.email_normalized, u.email_verified_at IS NOT NULL AS verified, m.role
           FROM account.users u JOIN account.memberships m ON m.user_id = u.id
          WHERE u.email_normalized = ANY($1) ORDER BY m.seat`,
        [[SEED_EMAILS.owner, ...SEED_EMAILS.collaborators]],
      );
      const staff = await c.query<{ email_normalized: string; role: string }>(
        `SELECT email_normalized, role FROM account.staff_users WHERE email_normalized = ANY($1)
          ORDER BY role`,
        [[SEED_EMAILS.support, SEED_EMAILS.admin]],
      );
      return { users: users.rows, staff: staff.rows };
    });
    expect(rows.users).toEqual([
      { email_normalized: SEED_EMAILS.owner, verified: true, role: 'owner' },
      { email_normalized: SEED_EMAILS.collaborators[0], verified: true, role: 'collaborator' },
      { email_normalized: SEED_EMAILS.collaborators[1], verified: true, role: 'collaborator' },
    ]);
    expect(rows.staff.map((s) => s.role)).toEqual(['admin', 'support']);
  });

  it('APP_ENV khác development/test → từ chối', async () => {
    await expect(
      runSeedAuth({
        ...env,
        APP_ENV: 'staging',
        MAIL_TRANSPORT: 'smtp',
        SMTP_URL: 'smtp://x:1',
        MAIL_FROM: 'a@b.test',
      }),
    ).rejects.toThrow(/chỉ chạy khi APP_ENV/);
  });
});
