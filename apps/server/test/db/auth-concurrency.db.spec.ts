import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../../src/modules/account';
import {
  createTestApp,
  registerAndVerify,
  STRONG_PASSWORD,
  tokenFromMail,
  uniqueEmail,
  waitForMail,
  type TestApp,
} from '../auth/helpers/app';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { asOwner, describeDb } from './helpers/db';
import { callRegister, roleClient, uniqueEmail as dbEmail, withRole } from './helpers/auth-seed';

// T042 (US1) + T059 (US3): đăng ký, tiêu thụ mã, ghế cộng tác viên khi chạy đồng thời.

describeDb('Xác thực – đồng thời', () => {
  let t: TestApp;
  let accounts: AccountPublicApi;
  beforeAll(async () => {
    t = await createTestApp();
    accounts = t.app.get<AccountPublicApi>(ACCOUNT_PUBLIC_API);
  });
  afterAll(async () => {
    await t.close();
  });

  describe('US1', () => {
    it('2 lần đăng ký đồng thời cùng email qua API → đúng 1 tài khoản', async () => {
      const email = uniqueEmail('dongthoi');
      const body = {
        displayName: 'A',
        email,
        password: STRONG_PASSWORD,
        acceptTerms: true,
        termsVersion: '2026-11',
      };
      const [r1, r2] = await Promise.all([
        t.agent().post('/api/v1/auth/register', body),
        t.agent().post('/api/v1/auth/register', body),
      ]);
      expect([r1.status, r2.status]).toEqual([202, 202]);
      const n = await asOwner(async (c) => {
        const r = await c.query('SELECT 1 FROM account.users WHERE email_normalized = $1', [email]);
        return r.rowCount;
      });
      expect(n).toBe(1);
    });

    it('tiêu thụ cùng một mã verify_email đồng thời 2 lần → đúng 1 thành công', async () => {
      const email = uniqueEmail('ma');
      await t.agent().post('/api/v1/auth/register', {
        displayName: 'B',
        email,
        password: STRONG_PASSWORD,
        acceptTerms: true,
        termsVersion: '2026-11',
      });
      const token = tokenFromMail(await waitForMail(t.mail, email));
      const results = await Promise.all(
        Array.from({ length: 4 }, () => t.agent().post('/api/v1/auth/email/verify', { token })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400, 400]);
    });

    it('AS4: lỗi giữa chừng trong auth_register → không còn dòng dở dang', async () => {
      // Ép lỗi ở câu INSERT cuối (trùng token_hash của mã khác – ràng buộc không phải email).
      const first = await withRole('app', (c) => callRegister(c, { emailNormalized: dbEmail() }));
      expect(first.result).toBe('created');
      const victim = dbEmail('do-dang');
      const victimAccount = uuidV7();
      const client = await roleClient('app');
      try {
        await expect(
          callRegister(client, {
            emailNormalized: victim,
            ids: { accountId: victimAccount, tokenHash: first.user.verifyTokenHash },
          }),
        ).rejects.toMatchObject({ code: '23505' });
      } finally {
        await client.end();
      }
      await asOwner(async (c) => {
        const u = await c.query('SELECT 1 FROM account.users WHERE email_normalized = $1', [
          victim,
        ]);
        expect(u.rowCount).toBe(0);
        // Câu INSERT accounts đầu tiên cũng bị hoàn tác cùng cả lời gọi.
        const acc = await c.query('SELECT 1 FROM account.accounts WHERE id = $1', [victimAccount]);
        expect(acc.rowCount).toBe(0);
      });
    });
  });

  describe('US3', () => {
    it('thêm đồng thời 3 cộng tác viên → đúng 2 thành công, lần 3 SEATS_FULL', async () => {
      const { me } = await registerAndVerify(t);
      const results = await Promise.allSettled(
        [1, 2, 3].map((i) =>
          accounts.addMember({
            accountId: me.account.id,
            displayName: `Cộng tác ${i}`,
            email: uniqueEmail(`ctv${i}`),
            password: STRONG_PASSWORD,
            emailVerified: true,
            addedByUserId: me.user.id,
          }),
        ),
      );
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');
      expect(ok).toHaveLength(2);
      expect(
        ok.map((r) => (r as PromiseFulfilledResult<{ seat: number }>).value.seat).sort(),
      ).toEqual([1, 2]);
      expect(failed).toHaveLength(1);
      expect(failed[0]!.reason).toMatchObject({ code: 'SEATS_FULL' });
    });

    it('gỡ một cộng tác viên giải phóng ghế cho người mới', async () => {
      const { me } = await registerAndVerify(t);
      const add = (i: number) =>
        accounts.addMember({
          accountId: me.account.id,
          displayName: `C${i}`,
          email: uniqueEmail(`g${i}`),
          addedByUserId: me.user.id,
        });
      const c1 = await add(1);
      await add(2);
      await accounts.removeMember({
        accountId: me.account.id,
        userId: c1.userId,
        byUserId: me.user.id,
      });
      expect((await add(3)).seat).toBe(1);
    });

    it('gỡ/khóa chủ → OWNER_REQUIRED; CHECK của CSDL chặn cả khi ghi thẳng', async () => {
      const { me } = await registerAndVerify(t);
      const input = { accountId: me.account.id, userId: me.user.id, byUserId: me.user.id };
      await expect(accounts.removeMember(input)).rejects.toMatchObject({ code: 'OWNER_REQUIRED' });
      await expect(accounts.disableMember(input)).rejects.toMatchObject({ code: 'OWNER_REQUIRED' });
      for (const status of ['removed', 'disabled']) {
        await expect(
          asOwner((c) =>
            c.query(`UPDATE account.memberships SET status = $1 WHERE user_id = $2`, [
              status,
              me.user.id,
            ]),
          ),
        ).rejects.toMatchObject({ code: '23514' });
      }
    });
  });
});
