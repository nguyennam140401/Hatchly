import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadConfig } from '../../src/core/config/load-config';
import { resolveOAuthConfig } from '../../src/core/config/oauth-config';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { OAuthFlowService } from '../../src/modules/account/internal/auth/oauth/oauth-flow.service';
import { TEST_AUTH_ENV } from '../helpers/auth-env';
import {
  acceptInvitationNew,
  asAppInAccount,
  markVerified,
  seedInvitation,
  seedUser,
  type SeededUser,
} from './helpers/auth-seed';
import { asOwner, dbUrls, describeDb, makeDatabase, type TestDatabase } from './helpers/db';

// 009 – T024 (CSDL), T047 (SC-005), T071 (SC-009): các bất biến dưới tải đồng thời.
//  - Lượt đăng nhập: hai yêu cầu cùng chuyển giai đoạn → đúng một thành công; state dùng một lần.
//  - Ghế: (vai trò active ∪ lời mời pending) ⊆ {1, 2} tại mọi thời điểm.
//  - Cách đăng nhập: hai yêu cầu gỡ đồng thời không bao giờ để lại 0 cách.

describeDb('Bất biến đồng thời của 009', () => {
  let database: TestDatabase;
  let flows: OAuthFlowService;

  beforeAll(() => {
    database = makeDatabase({ unit: 'api', poolMax: 10 });
    flows = new OAuthFlowService(
      resolveOAuthConfig(
        loadConfig({ APP_ENV: 'test', ...TEST_AUTH_ENV, DATABASE_APP_URL: dbUrls.app }),
      ),
    );
  });
  afterAll(async () => {
    await database.close();
  });

  // ----- oauth_flows -----

  it('lượt: chỉ lưu băm; state dùng đúng một lần; code_verifier về NULL ngay khi quay về', async () => {
    const started = await flows.start({ provider: 'google', purpose: 'login', usesPkce: true });
    expect(started.codeVerifier).not.toBeNull();
    const stored = await asOwner(async (c) => {
      const r = await c.query<Record<string, unknown>>(
        'SELECT * FROM account.oauth_flows WHERE id = $1',
        [started.id],
      );
      return r.rows[0];
    });
    // Mã cookie và state gốc không có trong CSDL (chỉ SHA-256).
    const dump = JSON.stringify(stored, (_k, v: unknown) =>
      Buffer.isBuffer(v) ? v.toString('base64url') : v,
    );
    expect(dump).not.toContain(started.flowToken);
    expect(dump).not.toContain(started.state);
    expect(stored?.stage).toBe('started');

    expect(await flows.consumeCallback(started.flowToken, 'sai-state')).toBeNull();
    expect(await flows.consumeCallback('sai-cookie', started.state)).toBeNull();
    const [a, b] = await Promise.all([
      flows.consumeCallback(started.flowToken, started.state),
      flows.consumeCallback(started.flowToken, started.state),
    ]);
    // Hai đường quay về đồng thời: đúng một cái khớp.
    expect([a, b].filter((x) => x !== null)).toHaveLength(1);
    const won = a ?? b;
    expect(won?.codeVerifier).toBe(started.codeVerifier);
    const after = await flows.findByCookie(started.flowToken);
    expect(after?.code_verifier).toBeNull();
    expect(await flows.consumeCallback(started.flowToken, started.state)).toBeNull();
  });

  it('chuyển giai đoạn là cập nhật có điều kiện: đồng thời → đúng một thành công; quá hạn → thất bại', async () => {
    const f = await flows.start({ provider: 'facebook', purpose: 'login', usesPkce: false });
    expect(f.codeVerifier).toBeNull();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        flows.transition(f.id, 'started', 'needs_signup', {}, 60_000),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    // Sai giai đoạn mong đợi → false (không ném).
    expect(await flows.transition(f.id, 'started', 'needs_email')).toBe(false);
    // Cạnh không có trong sơ đồ là lỗi lập trình.
    await expect(flows.transition(f.id, 'needs_signup', 'signed_in')).rejects.toThrow(/sơ đồ/);

    await asOwner((c) =>
      c.query(
        `UPDATE account.oauth_flows SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [f.id],
      ),
    );
    expect(await flows.transition(f.id, 'needs_signup', 'completed')).toBe(false);
    // Đóng lượt: một lần duy nhất.
    expect(await flows.fail(f.id, 'OAUTH_FLOW_INVALID')).toBe(true);
    expect(await flows.fail(f.id, 'OAUTH_FAILED')).toBe(false);
    expect((await flows.findByCookie(f.flowToken))?.result_code).toBe('OAUTH_FLOW_INVALID');
  });

  it('gửi lại liên kết đổi mail_token_hash: mã cũ không còn tra được; tra chỉ bằng băm', async () => {
    const f = await flows.start({ provider: 'google', purpose: 'login', usesPkce: true });
    // Chưa ở awaiting_email → không phát mã.
    expect(await flows.issueMailToken(f.id, 60_000)).toBeNull();
    await flows.transition(f.id, 'started', 'needs_email', {}, 60_000);
    await flows.transition(f.id, 'needs_email', 'awaiting_email', {}, 60_000);
    const first = await flows.issueMailToken(f.id, 60_000);
    const second = await flows.issueMailToken(f.id, 60_000);
    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
    expect(await flows.findByMailToken(first!)).toBeUndefined();
    expect((await flows.findByMailToken(second!))?.id).toBe(f.id);
    // Kết thúc lượt → mã trong thư hết tra được.
    await flows.transition(f.id, 'awaiting_email', 'completed');
    expect(await flows.findByMailToken(second!)).toBeUndefined();
  });

  // ----- Ghế (SC-005) -----

  async function seats(accountId: string) {
    return asOwner(async (c) => {
      const r = await c.query<{ seat: number; kind: string }>(
        `SELECT seat, 'member' AS kind FROM account.memberships
          WHERE account_id = $1 AND status = 'active' AND role = 'collaborator'
         UNION ALL
         SELECT seat, 'invite' FROM account.invitations
          WHERE account_id = $1 AND status = 'pending'`,
        [accountId],
      );
      return r.rows;
    });
  }

  it('chấp nhận đồng thời hai lời mời cùng ghế → đúng một accepted; ghế luôn ⊆ {1, 2}', async () => {
    const owner = await seedUser();
    // Hai lời mời cùng ghế không thể cùng pending (chỉ mục duy nhất) – mô phỏng tranh chấp bằng một lời
    // mời được nhiều yêu cầu chấp nhận cùng lúc.
    const inv = await seedInvitation(owner, { seat: 1 });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => acceptInvitationNew(inv).then((r) => r.result)),
    );
    expect(results.filter((r) => r === 'accepted')).toHaveLength(1);
    expect(results.filter((r) => r !== 'accepted').every((r) => r === 'invalid')).toBe(true);
    const now = await seats(owner.accountId);
    expect(now).toEqual([{ seat: 1, kind: 'member' }]);
  });

  it('1.000 thao tác mời / chấp nhận / hủy đan xen → không lúc nào vượt 2 chỗ, không trùng ghế', async () => {
    const owner = await seedUser();
    let violations = 0;
    const check = async () => {
      const rows = await seats(owner.accountId);
      const used = rows.map((r) => r.seat);
      if (
        rows.length > 2 ||
        new Set(used).size !== used.length ||
        used.some((s) => s < 1 || s > 2)
      ) {
        violations += 1;
      }
    };
    // Mời = chèn lời mời vào ghế trống dưới khóa ghế (đúng trình tự của dịch vụ); thất bại do tranh chấp
    // chỉ mục duy nhất là kết quả hợp lệ.
    const invite = async () => {
      try {
        await asAppInAccount(owner.accountId, async (c) => {
          await c.query(
            `SELECT pg_advisory_xact_lock(hashtextextended('account.seats:' || $1::uuid::text, 0))`,
            [owner.accountId],
          );
          const taken = await c.query<{ seat: number }>(
            `SELECT seat FROM account.memberships WHERE status = 'active'
             UNION SELECT seat FROM account.invitations WHERE status = 'pending'`,
          );
          const used = new Set(taken.rows.map((r) => r.seat));
          const seat = [1, 2].find((s) => !used.has(s));
          if (seat === undefined) return;
          const email = `ghe.${uuidV7()}@example.test`;
          await c.query(
            `INSERT INTO account.invitations (id, account_id, email, email_normalized,
               invited_by_user_id, role, seat, status, token_hash, last_sent_at, expires_at)
             VALUES ($1, $2, $3, $3, $4, 'collaborator', $5, 'pending', sha256($1::text::bytea),
               now(), now() + interval '7 days')`,
            [uuidV7(), owner.accountId, email, owner.userId, seat],
          );
        });
      } catch {
        // tranh chấp → bỏ qua
      }
    };
    const pending = () =>
      asOwner(async (c) => {
        const r = await c.query<{
          id: string;
          token_hash: Buffer;
          email_normalized: string;
          seat: number;
        }>(
          `SELECT id, token_hash, email_normalized, seat FROM account.invitations
            WHERE account_id = $1 AND status = 'pending' ORDER BY random() LIMIT 1`,
          [owner.accountId],
        );
        return r.rows[0];
      });
    const accept = async () => {
      const row = await pending();
      if (row === undefined) return;
      await acceptInvitationNew({
        invitationId: row.id,
        accountId: owner.accountId,
        token: '',
        tokenHash: row.token_hash,
        emailNormalized: row.email_normalized,
        seat: row.seat,
      }).catch(() => undefined);
    };
    const cancel = async () => {
      await asAppInAccount(owner.accountId, (c) =>
        c.query(
          `UPDATE account.invitations SET status = 'cancelled', closed_at = now()
            WHERE id = (SELECT id FROM account.invitations WHERE status = 'pending' LIMIT 1)
              AND status = 'pending'`,
        ),
      ).catch(() => undefined);
    };
    // Gỡ thành viên để chỗ được quay vòng (member_detach, đường thật).
    const remove = async () => {
      await asAppInAccount(owner.accountId, async (c) => {
        const m = await c.query<{ user_id: string }>(
          `SELECT user_id FROM account.memberships
            WHERE role = 'collaborator' AND status = 'active' LIMIT 1`,
        );
        const id = m.rows[0]?.user_id;
        if (id === undefined) return;
        await c.query(`SELECT account.member_detach($1, $2, $3, $4, $5)`, [
          id,
          uuidV7(),
          uuidV7(),
          uuidV7(),
          owner.userId,
        ]);
      }).catch(() => undefined);
    };
    const ops = [invite, invite, accept, cancel, remove];
    const ROUNDS = 100;
    const PER_ROUND = 10;
    for (let round = 0; round < ROUNDS; round++) {
      await Promise.all(
        Array.from({ length: PER_ROUND }, (_, i) =>
          (ops[(round + i) % ops.length] as () => Promise<void>)(),
        ),
      );
      await check();
    }
    expect(violations).toBe(0);
  }, 180_000);

  // ----- Cách đăng nhập cuối cùng (SC-009) -----

  async function addIdentity(user: SeededUser, provider: 'google' | 'facebook') {
    await asOwner((c) =>
      c.query(
        `INSERT INTO account.login_identities (id, account_id, user_id, provider, provider_subject)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidV7(), user.accountId, user.userId, provider, `sub-${uuidV7()}`],
      ),
    );
  }

  /** Đúng câu lệnh của LoginMethodsService.remove: khóa mọi dòng của người dùng, đếm, rồi mới xóa. */
  async function removeKind(
    user: SeededUser,
    kind: string,
  ): Promise<'removed' | 'last' | 'missing'> {
    return asAppInAccount(user.accountId, async (c) => {
      const rows = await c.query<{ id: string; provider: string }>(
        'SELECT id, provider FROM account.login_identities WHERE user_id = $1 FOR UPDATE',
        [user.userId],
      );
      const target = rows.rows.find((r) => r.provider === kind);
      if (target === undefined) return 'missing';
      if (rows.rows.length < 2) return 'last';
      await c.query('DELETE FROM account.login_identities WHERE id = $1', [target.id]);
      return 'removed';
    });
  }

  it('người có đúng 2 cách: hai yêu cầu gỡ (mỗi cái một cách) đồng thời, lặp 200 lần → luôn còn đúng 1', async () => {
    const user = await seedUser();
    await markVerified(user.userId);
    for (let i = 0; i < 200; i++) {
      await addIdentity(user, 'google');
      const count = async () =>
        asOwner(async (c) =>
          Number(
            (
              await c.query<{ n: string }>(
                'SELECT count(*)::text AS n FROM account.login_identities WHERE user_id = $1',
                [user.userId],
              )
            ).rows[0]?.n,
          ),
        );
      expect(await count()).toBe(2);
      const results = await Promise.all([removeKind(user, 'password'), removeKind(user, 'google')]);
      expect(results.filter((r) => r === 'removed')).toHaveLength(1);
      expect(await count()).toBe(1);
      // Đưa về trạng thái "chỉ còn mật khẩu" cho vòng sau.
      await asOwner(async (c) => {
        const left = await c.query<{ provider: string }>(
          'SELECT provider FROM account.login_identities WHERE user_id = $1',
          [user.userId],
        );
        if (left.rows[0]?.provider === 'google') {
          await c.query(
            `UPDATE account.login_identities
                SET provider = 'password', provider_subject = user_id::text, password_hash = 'x'
              WHERE user_id = $1`,
            [user.userId],
          );
        }
      });
    }
    // Người có 1 cách → gỡ luôn bị từ chối.
    expect(await removeKind(user, 'password')).toBe('last');
  }, 180_000);
});
