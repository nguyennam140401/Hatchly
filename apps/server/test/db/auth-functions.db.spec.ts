import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { asOwner, describeDb } from './helpers/db';
import {
  callRegister,
  roleClient,
  seedSession,
  seedUser,
  sha256,
  uniqueEmail,
  withRole,
} from './helpers/auth-seed';

// T013 (004, data-model.md mục 4, research R4): 4 hàm SECURITY DEFINER – quyền gọi, cột trả về,
// đăng ký đồng thời nguyên vẹn, điều kiện hiệu lực của phiên và mã một lần.

const RESOLVE = `SELECT * FROM account.auth_resolve_session($1, interval '1 hour', interval '14 days')`;
const FIND = `SELECT * FROM account.auth_find_token($1, $2)`;

describeDb('Hàm SECURITY DEFINER của xác thực', () => {
  it('support và system không gọi được 4 hàm', async () => {
    const calls = [
      [`SELECT account.auth_lookup_email('x@example.test')`, []],
      [RESOLVE, [sha256('x')]],
      [FIND, [sha256('x'), 'verify_email']],
    ] as const;
    for (const role of ['support', 'system'] as const) {
      await withRole(role, async (c) => {
        for (const [q, params] of calls) {
          await expect(c.query(q, [...params])).rejects.toMatchObject({ code: '42501' });
        }
        await expect(callRegister(c, { emailNormalized: uniqueEmail() })).rejects.toMatchObject({
          code: '42501',
        });
      });
    }
  });

  it('mỗi hàm chỉ trả đúng các cột trong hợp đồng', async () => {
    const user = await seedUser();
    const { tokenHash } = await seedSession(user);
    await withRole('app', async (c) => {
      const lookup = await c.query(`SELECT * FROM account.auth_lookup_email($1)`, [
        user.emailNormalized,
      ]);
      expect(lookup.fields.map((f) => f.name)).toEqual([
        'user_id',
        'account_id',
        'display_name',
        'password_hash',
        'user_status',
        'member_status',
        'account_status',
        'email_verified_at',
      ]);
      expect(lookup.rows[0]).toMatchObject({ user_id: user.userId, account_id: user.accountId });

      const session = await c.query(RESOLVE, [tokenHash]);
      expect(session.fields.map((f) => f.name)).toEqual([
        'session_id',
        'user_id',
        'account_id',
        'role',
        'email_verified',
        'display_name',
        'absolute_expires_at',
      ]);
      expect(session.rows[0]).toMatchObject({ role: 'owner', email_verified: false });

      const token = await c.query(FIND, [user.verifyTokenHash, 'verify_email']);
      expect(token.fields.map((f) => f.name)).toEqual([
        'token_id',
        'account_id',
        'user_id',
        'email_normalized',
      ]);
      expect(token.rows).toHaveLength(1);
    });
  });

  it('auth_register đồng thời cùng email → 1 created, 1 email_taken, không còn dòng dở dang', async () => {
    const email = uniqueEmail('race');
    const [c1, c2] = await Promise.all([roleClient('app'), roleClient('app')]);
    try {
      const results = await Promise.all([
        callRegister(c1, { emailNormalized: email }),
        callRegister(c2, { emailNormalized: email }),
      ]);
      expect(results.map((r) => r.result).sort()).toEqual(['created', 'email_taken']);
      const loser = results.find((r) => r.result === 'email_taken');
      if (loser === undefined) throw new Error('thiếu bên thua');
      await asOwner(async (c) => {
        const acc = await c.query('SELECT 1 FROM account.accounts WHERE id = $1', [
          loser.user.accountId,
        ]);
        expect(acc.rowCount).toBe(0);
        for (const table of ['users', 'login_identities', 'memberships', 'auth_tokens']) {
          const r = await c.query(`SELECT 1 FROM account.${table} WHERE account_id = $1`, [
            loser.user.accountId,
          ]);
          expect(r.rowCount, table).toBe(0);
        }
        const winner = await c.query('SELECT 1 FROM account.users WHERE email_normalized = $1', [
          email,
        ]);
        expect(winner.rowCount).toBe(1);
      });
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
  });

  it('auth_resolve_session trả 0 dòng khi phiên/người dùng/thành viên/tài khoản không hiệu lực', async () => {
    const cases: [string, () => Promise<Buffer>][] = [
      [
        'đã thu hồi',
        async () => (await seedSession(await seedUser(), { revoked: true })).tokenHash,
      ],
      [
        'quá hạn không hoạt động',
        async () => (await seedSession(await seedUser(), { idle: '-1 minute' })).tokenHash,
      ],
      [
        'quá hạn tuyệt đối',
        async () => (await seedSession(await seedUser(), { absolute: '-1 minute' })).tokenHash,
      ],
      [
        'người dùng disabled',
        async () => {
          const u = await seedUser();
          const s = await seedSession(u);
          await asOwner((c) =>
            c.query(`UPDATE account.users SET status = 'disabled' WHERE id = $1`, [u.userId]),
          );
          return s.tokenHash;
        },
      ],
      [
        'thành viên removed',
        async () => {
          // Biến thành viên thành cộng tác viên đã gỡ (sửa bằng vai trò CSDL `owner`).
          const u = await seedUser();
          await asOwner(async (c) => {
            await c.query(
              `UPDATE account.memberships SET role = 'collaborator', seat = 1, status = 'removed' WHERE user_id = $1`,
              [u.userId],
            );
          });
          return (await seedSession(u)).tokenHash;
        },
      ],
      [
        'tài khoản deleting',
        async () => {
          const u = await seedUser();
          const s = await seedSession(u);
          await asOwner((c) =>
            c.query(`UPDATE account.accounts SET status = 'deleting' WHERE id = $1`, [u.accountId]),
          );
          return s.tokenHash;
        },
      ],
    ];
    await withRole('app', async (c) => {
      for (const [name, make] of cases) {
        const r = await c.query(RESOLVE, [await make()]);
        expect(r.rowCount, name).toBe(0);
      }
      const ok = await seedSession(await seedUser());
      expect((await c.query(RESOLVE, [ok.tokenHash])).rowCount).toBe(1);
    });
  });

  it('auth_resolve_session chỉ gia hạn khi last_seen_at cũ hơn p_touch_after', async () => {
    const u = await seedUser();
    const fresh = await seedSession(u, { idle: '1 hour' });
    const stale = await seedSession(u, { idle: '1 hour', lastSeen: '-2 hours' });
    await withRole('app', async (c) => {
      await c.query(RESOLVE, [fresh.tokenHash]);
      await c.query(RESOLVE, [stale.tokenHash]);
    });
    await asOwner(async (c) => {
      const r = await c.query<{ id: string; extended: boolean }>(
        `SELECT id, idle_expires_at > now() + interval '13 days' AS extended FROM account.sessions WHERE id = ANY($1)`,
        [[fresh.sessionId, stale.sessionId]],
      );
      const byId = Object.fromEntries(r.rows.map((row) => [row.id, row.extended]));
      expect(byId[fresh.sessionId]).toBe(false);
      expect(byId[stale.sessionId]).toBe(true);
    });
  });

  it('auth_find_token trả 0 dòng với mã đã dùng, hết hạn, sai mục đích; không tiêu thụ mã', async () => {
    const used = await seedUser();
    const expired = await seedUser();
    const valid = await seedUser();
    await asOwner(async (c) => {
      await c.query(`UPDATE account.auth_tokens SET used_at = now() WHERE user_id = $1`, [
        used.userId,
      ]);
      await c.query(
        `UPDATE account.auth_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1`,
        [expired.userId],
      );
    });
    await withRole('app', async (c) => {
      expect((await c.query(FIND, [used.verifyTokenHash, 'verify_email'])).rowCount).toBe(0);
      expect((await c.query(FIND, [expired.verifyTokenHash, 'verify_email'])).rowCount).toBe(0);
      expect((await c.query(FIND, [valid.verifyTokenHash, 'reset_password'])).rowCount).toBe(0);
      expect((await c.query(FIND, [sha256(randomBytes(8)), 'verify_email'])).rowCount).toBe(0);
      // Gọi hai lần vẫn thấy: hàm không tiêu thụ.
      expect((await c.query(FIND, [valid.verifyTokenHash, 'verify_email'])).rowCount).toBe(1);
      expect((await c.query(FIND, [valid.verifyTokenHash, 'verify_email'])).rowCount).toBe(1);
    });
  });

  it('auth_lookup_email bỏ qua tài khoản đã xóa', async () => {
    const u = await seedUser();
    await asOwner((c) =>
      c.query(`UPDATE account.accounts SET deleted_at = now() WHERE id = $1`, [u.accountId]),
    );
    await withRole('app', async (c) => {
      const r = await c.query(`SELECT * FROM account.auth_lookup_email($1)`, [u.emailNormalized]);
      expect(r.rowCount).toBe(0);
    });
  });

  it('app vẫn không INSERT trực tiếp được account.accounts', async () => {
    await withRole('app', async (c) => {
      await expect(
        c.query(`INSERT INTO account.accounts (id, status) VALUES (gen_random_uuid(), 'active')`),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
