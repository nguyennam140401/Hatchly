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
  it('lần đầu tạo chủ + 1 cộng tác viên + lời mời chờ + người ở tài khoản chờ + 2 nhân viên; lần hai bỏ qua', async () => {
    const first = await runSeedAuth(env);
    expect(first.created).toBe(true);
    expect(first.password).toMatch(/^Mau-/);
    expect(first.inviteToken).toMatch(/^[\w-]{20,}$/);
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
      // Lời mời đang chờ: đúng một dòng, chiếm ghế còn lại, chỉ lưu băm mã (không có cột mã rõ).
      const invites = await c.query<{ status: string; seat: number; role: string }>(
        `SELECT status, seat, role FROM account.invitations WHERE email_normalized = $1`,
        [SEED_EMAILS.invited],
      );
      // Người ở tài khoản chờ: đã rời tài khoản mẫu → chủ một tài khoản `unclaimed`, vai trò cũ `removed`.
      const detached = await c.query<{ account_status: string; detached: boolean }>(
        `SELECT a.status AS account_status, u.detached_at IS NOT NULL AS detached
           FROM account.users u JOIN account.accounts a ON a.id = u.account_id
          WHERE u.email_normalized = $1`,
        [SEED_EMAILS.detached],
      );
      return {
        users: users.rows,
        staff: staff.rows,
        invites: invites.rows,
        detached: detached.rows,
      };
    });
    expect(rows.users).toEqual([
      { email_normalized: SEED_EMAILS.owner, verified: true, role: 'owner' },
      { email_normalized: SEED_EMAILS.collaborators[0], verified: true, role: 'collaborator' },
    ]);
    expect(rows.staff.map((s) => s.role)).toEqual(['admin', 'support']);
    // Chạy hai lần vẫn đúng một lời mời; 1 cộng tác viên + 1 lời mời = đủ 2/2 chỗ.
    expect(rows.invites).toEqual([{ status: 'pending', seat: 2, role: 'collaborator' }]);
    expect(rows.detached).toEqual([{ account_status: 'unclaimed', detached: true }]);
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
