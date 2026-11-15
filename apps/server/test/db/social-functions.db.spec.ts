import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { asOwner, describeDb } from './helpers/db';
import {
  acceptInvitationNew,
  asAppInAccount,
  callDetach,
  callRegisterOAuth,
  markVerified,
  roleClient,
  seedCollaborator,
  seedDetachedUser,
  seedInvitation,
  seedSession,
  seedUser,
  sha256,
  uniqueEmail,
  withRole,
  type SeededInvitation,
  type SeededUser,
} from './helpers/auth-seed';

// T010 (009, data-model.md mục 4): 11 hàm SECURITY DEFINER của đăng nhập qua nhà cung cấp, lời mời,
// tài khoản chờ – quyền gọi, cột trả về, kết quả theo từng nhánh, tính nguyên vẹn và chạy lại an toàn.

const RESOLVE_V2 = `SELECT * FROM account.auth_resolve_session_v2($1, interval '1 hour', interval '14 days')`;
const ZERO = '00000000-0000-7000-8000-000000000000';

/** Lời gọi tối thiểu của từng hàm (tham số giả) – chỉ để kiểm quyền EXECUTE. */
const APP_CALLS: [string, unknown[]][] = [
  [RESOLVE_V2, [sha256('x')]],
  [`SELECT * FROM account.auth_lookup_identity('google', 'x')`, []],
  [
    `SELECT account.auth_register_oauth($1, $1, $1, $1, 'a', 'a@x.test', 'a@x.test', true, 'google', 'x', NULL, NULL, 'v')`,
    [ZERO],
  ],
  [`SELECT * FROM account.auth_find_invitation($1)`, [sha256('x')]],
  [`SELECT * FROM account.auth_pending_invitations_for_email('a@x.test')`, []],
  [
    `SELECT account.auth_accept_invitation_new($1, $2, $1, $1, $1, 'a', 'h', NULL, NULL, NULL, NULL, 'v')`,
    [ZERO, sha256('x')],
  ],
  [`SELECT account.auth_accept_invitation_existing($1, $1)`, [ZERO]],
  [`SELECT account.member_detach($1, $1, $1, $1, $1)`, [ZERO]],
];
const SYSTEM_CALLS: [string, unknown[]][] = [
  [`SELECT * FROM account.detached_users_due('notice', 10, 90, 7)`, []],
  [`SELECT account.purge_detached_account($1, 90, 7)`, [ZERO]],
  [`SELECT * FROM account.auth_housekeeping()`, []],
];

async function ownerRows<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asOwner(async (c) => (await c.query<T>(sql, params)).rows);
}

async function verifiedOwner(): Promise<SeededUser> {
  const owner = await seedUser();
  await markVerified(owner.userId);
  return owner;
}

async function acceptExisting(invitationId: string, userId: string): Promise<string> {
  return withRole('app', async (c) => {
    const r = await c.query<{ result: string }>(
      `SELECT account.auth_accept_invitation_existing($1, $2) AS result`,
      [invitationId, userId],
    );
    return r.rows[0]?.result ?? '';
  });
}

describeDb('Hàm SECURITY DEFINER của 009 (đăng nhập nhà cung cấp, lời mời, tài khoản chờ)', () => {
  // ----- (a) quyền gọi -----
  it('(a) vai trò không được cấp gọi → 42501: app ↔ system, support không gọi được hàm nào', async () => {
    await withRole('system', async (c) => {
      for (const [q, params] of APP_CALLS) {
        await expect(c.query(q, params), q).rejects.toMatchObject({ code: '42501' });
      }
    });
    await withRole('app', async (c) => {
      for (const [q, params] of SYSTEM_CALLS) {
        await expect(c.query(q, params), q).rejects.toMatchObject({ code: '42501' });
      }
    });
    await withRole('support', async (c) => {
      for (const [q, params] of [...APP_CALLS, ...SYSTEM_CALLS]) {
        await expect(c.query(q, params), q).rejects.toMatchObject({ code: '42501' });
      }
    });
  });

  // ----- (b) cột trả về -----
  it('(b) mỗi hàm chỉ trả đúng các cột trong hợp đồng', async () => {
    const owner = await verifiedOwner();
    const { tokenHash } = await seedSession(owner);
    const inv = await seedInvitation(owner);
    await withRole('app', async (c) => {
      const cols = async (q: string, params: unknown[]) =>
        (await c.query(q, params)).fields.map((f) => f.name);
      expect(await cols(RESOLVE_V2, [tokenHash])).toEqual([
        'session_id',
        'user_id',
        'account_id',
        'role',
        'email_verified',
        'display_name',
        'absolute_expires_at',
        'detached',
      ]);
      expect(await cols(`SELECT * FROM account.auth_lookup_identity('google', 'x')`, [])).toEqual([
        'user_id',
        'account_id',
        'user_status',
        'member_status',
        'account_status',
        'email_verified_at',
      ]);
      expect(await cols(`SELECT * FROM account.auth_find_invitation($1)`, [inv.tokenHash])).toEqual(
        [
          'invitation_id',
          'account_id',
          'email',
          'email_normalized',
          'account_label',
          'inviter_display_name',
          'expires_at',
          'existing_user_state',
        ],
      );
      expect(
        await cols(`SELECT * FROM account.auth_pending_invitations_for_email($1)`, [
          inv.emailNormalized,
        ]),
      ).toEqual(['invitation_id', 'account_label', 'inviter_display_name', 'expires_at']);
    });
    await withRole('system', async (c) => {
      const due = await c.query(`SELECT * FROM account.detached_users_due('purge', 5, 90, 7)`);
      expect(due.fields.map((f) => f.name)).toEqual(['account_id', 'user_id']);
      const hk = await c.query(`SELECT * FROM account.auth_housekeeping()`);
      expect(hk.fields.map((f) => f.name)).toEqual(['account_id', 'invitation_id']);
    });
  });

  // ----- (c) tra phiên bản 2 -----
  it('(c) auth_resolve_session_v2: detached = false ở tài khoản thật, true ở tài khoản chờ', async () => {
    const owner = await verifiedOwner();
    const ownerSession = await seedSession(owner);
    const detachedUser = await seedDetachedUser(owner);
    const detachedSession = await seedSession(detachedUser);
    await withRole('app', async (c) => {
      const a = await c.query(RESOLVE_V2, [ownerSession.tokenHash]);
      expect(a.rows[0]).toMatchObject({ user_id: owner.userId, role: 'owner', detached: false });
      const b = await c.query(RESOLVE_V2, [detachedSession.tokenHash]);
      expect(b.rows[0]).toMatchObject({
        user_id: detachedUser.userId,
        account_id: detachedUser.accountId,
        role: 'owner',
        detached: true,
      });
      // Hàm cũ vẫn chạy (bản API cũ khi phát hành – R20).
      const legacy = await c.query(
        `SELECT * FROM account.auth_resolve_session($1, interval '1 hour', interval '14 days')`,
        [ownerSession.tokenHash],
      );
      expect(legacy.rows).toHaveLength(1);
    });
  });

  // ----- (d) tra danh tính -----
  it('(d) auth_lookup_identity khớp chính xác, bỏ qua tài khoản đã xóa và nhà cung cấp password', async () => {
    const reg = await withRole('app', (c) => callRegisterOAuth(c, { provider: 'facebook' }));
    expect(reg.result).toBe('created');
    await withRole('app', async (c) => {
      const lookup = (provider: string, subject: string) =>
        c.query(`SELECT * FROM account.auth_lookup_identity($1, $2)`, [provider, subject]);
      expect((await lookup('facebook', reg.subject)).rows[0]).toMatchObject({
        user_id: reg.user.userId,
        account_id: reg.user.accountId,
        user_status: 'active',
        member_status: 'active',
        account_status: 'active',
      });
      expect((await lookup('google', reg.subject)).rows).toHaveLength(0);
      expect((await lookup('facebook', `${reg.subject}x`)).rows).toHaveLength(0);
      expect((await lookup('facebook', reg.subject.toUpperCase())).rows).toHaveLength(0);
      // Danh tính mật khẩu (subject = user_id) không tra được qua hàm này.
      const pw = await seedUser();
      expect((await lookup('password', pw.userId)).rows).toHaveLength(0);
    });
    await asOwner((c) =>
      c.query('UPDATE account.accounts SET deleted_at = now() WHERE id = $1', [reg.user.accountId]),
    );
    await withRole('app', async (c) => {
      const r = await c.query(`SELECT * FROM account.auth_lookup_identity('facebook', $1)`, [
        reg.subject,
      ]);
      expect(r.rows).toHaveLength(0);
    });
  });

  // ----- (e) đăng ký qua nhà cung cấp -----
  it('(e) auth_register_oauth: created tạo đủ 4 dòng; email_taken / identity_taken không để lại gì', async () => {
    const first = await withRole('app', (c) => callRegisterOAuth(c, { emailVerified: true }));
    expect(first.result).toBe('created');
    const rows = await ownerRows<{ status: string; verified: boolean; provider: string }>(
      `SELECT a.status, (u.email_verified_at IS NOT NULL) AS verified, li.provider
         FROM account.accounts a
         JOIN account.users u ON u.account_id = a.id
         JOIN account.login_identities li ON li.user_id = u.id
         JOIN account.memberships m ON m.user_id = u.id AND m.role = 'owner' AND m.seat = 0
        WHERE a.id = $1`,
      [first.user.accountId],
    );
    expect(rows).toEqual([{ status: 'active', verified: true, provider: 'google' }]);

    const unverified = await withRole('app', (c) => callRegisterOAuth(c, { emailVerified: false }));
    const u = await ownerRows<{ v: Date | null }>(
      'SELECT email_verified_at AS v FROM account.users WHERE id = $1',
      [unverified.user.userId],
    );
    expect(u[0]?.v).toBeNull();

    const sameEmail = await withRole('app', (c) =>
      callRegisterOAuth(c, { emailNormalized: first.user.emailNormalized }),
    );
    expect(sameEmail.result).toBe('email_taken');
    const sameIdentity = await withRole('app', (c) =>
      callRegisterOAuth(c, { subject: first.subject }),
    );
    expect(sameIdentity.result).toBe('identity_taken');
    for (const loser of [sameEmail, sameIdentity]) {
      const left = await ownerRows('SELECT 1 FROM account.accounts WHERE id = $1', [
        loser.user.accountId,
      ]);
      expect(left).toHaveLength(0);
    }
    await withRole('app', async (c) => {
      await expect(
        c.query(
          `SELECT account.auth_register_oauth($1, $2, $3, $4, 'a', $5, $5, true, 'password', 'x', NULL, NULL, 'v')`,
          [uuidV7(), uuidV7(), uuidV7(), uuidV7(), uniqueEmail()],
        ),
      ).rejects.toMatchObject({ code: '22023' });
    });
  });

  it('(e) hai lượt đăng ký đồng thời cùng danh tính → đúng một created', async () => {
    const subject = `race-${randomBytes(6).toString('hex')}`;
    const [c1, c2] = await Promise.all([roleClient('app'), roleClient('app')]);
    try {
      const results = await Promise.all([
        callRegisterOAuth(c1, { subject }),
        callRegisterOAuth(c2, { subject }),
      ]);
      expect(results.map((r) => r.result).sort()).toEqual(['created', 'identity_taken']);
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
  });

  // ----- (f) tra lời mời -----
  it('(f) auth_find_invitation: chỉ pending + chưa quá hạn + tài khoản không deleting; existing_user_state', async () => {
    const owner = await verifiedOwner();
    const find = (inv: SeededInvitation) =>
      withRole('app', async (c) => {
        const r = await c.query<{ existing_user_state: string; account_id: string }>(
          `SELECT * FROM account.auth_find_invitation($1)`,
          [inv.tokenHash],
        );
        return r.rows;
      });
    const fresh = await seedInvitation(owner, { seat: 1 });
    expect((await find(fresh))[0]).toMatchObject({
      invitation_id: fresh.invitationId,
      account_id: owner.accountId,
      email_normalized: fresh.emailNormalized,
      account_label: 'Tiệm thử',
      inviter_display_name: 'Người thử',
      existing_user_state: 'none',
    });
    expect(await find(await seedInvitation(owner, { seat: 2, expires: '-1 minute' }))).toEqual([]);
    for (const status of ['accepted', 'cancelled', 'expired'] as const) {
      expect(await find(await seedInvitation(owner, { status })), status).toEqual([]);
    }
    // Email đã có người dùng: đang là thành viên tài khoản khác → member; ở tài khoản chờ → detached.
    const other = await verifiedOwner();
    const member = await seedInvitation(other, { emailNormalized: owner.emailNormalized });
    expect((await find(member))[0]?.existing_user_state).toBe('member');
    const third = await verifiedOwner();
    const loose = await seedDetachedUser(third);
    const forDetached = await seedInvitation(other, {
      seat: 2,
      emailNormalized: loose.emailNormalized,
    });
    expect((await find(forDetached))[0]?.existing_user_state).toBe('detached');
    // Tài khoản mời đang bị xóa (FR-024).
    await asOwner((c) =>
      c.query(`UPDATE account.accounts SET status = 'deleting' WHERE id = $1`, [owner.accountId]),
    );
    expect(await find(fresh)).toEqual([]);
  });

  // ----- (m) lời mời theo email -----
  it('(m) auth_pending_invitations_for_email: chỉ pending, chưa quá hạn, tài khoản không deleting', async () => {
    const email = uniqueEmail('mine');
    const a = await verifiedOwner();
    const b = await verifiedOwner();
    const c3 = await verifiedOwner();
    const live = await seedInvitation(a, { emailNormalized: email });
    await seedInvitation(b, { emailNormalized: email, expires: '-1 minute' });
    await seedInvitation(b, { emailNormalized: email, seat: 2, status: 'cancelled' });
    await seedInvitation(c3, { emailNormalized: email });
    await asOwner((c) =>
      c.query(`UPDATE account.accounts SET status = 'deleting' WHERE id = $1`, [c3.accountId]),
    );
    await withRole('app', async (c) => {
      const r = await c.query<{ invitation_id: string }>(
        `SELECT * FROM account.auth_pending_invitations_for_email($1)`,
        [email],
      );
      expect(r.rows.map((row) => row.invitation_id)).toEqual([live.invitationId]);
    });
  });

  // ----- (g) chấp nhận – người mới -----
  it('(g) auth_accept_invitation_new: accepted tạo người dùng đã xác minh ở đúng ghế; lời mời dùng một lần', async () => {
    const owner = await verifiedOwner();
    const inv = await seedInvitation(owner, { seat: 2 });
    const done = await acceptInvitationNew(inv);
    expect(done.result).toBe('accepted');
    const rows = await ownerRows(
      `SELECT u.account_id, u.email_normalized, (u.email_verified_at IS NOT NULL) AS verified,
              m.role, m.seat, m.status, li.provider, i.status AS inv_status, i.accepted_user_id
         FROM account.users u
         JOIN account.memberships m ON m.user_id = u.id AND m.account_id = u.account_id
         JOIN account.login_identities li ON li.user_id = u.id
         JOIN account.invitations i ON i.id = $2
        WHERE u.id = $1`,
      [done.userId, inv.invitationId],
    );
    expect(rows).toEqual([
      {
        account_id: owner.accountId,
        email_normalized: inv.emailNormalized,
        verified: true,
        role: 'collaborator',
        seat: 2,
        status: 'active',
        provider: 'password',
        inv_status: 'accepted',
        accepted_user_id: done.userId,
      },
    ]);
    expect((await acceptInvitationNew(inv)).result).toBe('invalid');
  });

  it('(g) auth_accept_invitation_new: invalid | email_in_use | identity_taken | seat_taken', async () => {
    const owner = await verifiedOwner();
    // invalid: sai mã, quá hạn, không tồn tại.
    const inv = await seedInvitation(owner, { seat: 1 });
    expect((await acceptInvitationNew({ ...inv, tokenHash: sha256('sai') })).result, 'sai mã').toBe(
      'invalid',
    );
    expect((await acceptInvitationNew({ ...inv, invitationId: uuidV7() })).result).toBe('invalid');
    const expired = await seedInvitation(owner, { seat: 2, expires: '-1 second' });
    expect((await acceptInvitationNew(expired)).result).toBe('invalid');
    await asOwner((c) =>
      c.query(`DELETE FROM account.invitations WHERE id = $1`, [expired.invitationId]),
    );
    // email_in_use: email được mời đã có người dùng (ở tài khoản khác).
    const other = await verifiedOwner();
    const taken = await seedInvitation(owner, { seat: 2, emailNormalized: other.emailNormalized });
    expect((await acceptInvitationNew(taken)).result).toBe('email_in_use');
    await asOwner((c) =>
      c.query(`DELETE FROM account.invitations WHERE id = $1`, [taken.invitationId]),
    );
    // identity_taken: danh tính nhà cung cấp đã gắn người khác – lời mời vẫn pending.
    const existing = await withRole('app', (c) => callRegisterOAuth(c));
    expect(
      (await acceptInvitationNew(inv, { provider: 'google', subject: existing.subject })).result,
    ).toBe('identity_taken');
    const still = await ownerRows<{ status: string }>(
      'SELECT status FROM account.invitations WHERE id = $1',
      [inv.invitationId],
    );
    expect(still[0]?.status).toBe('pending');
    // seat_taken: ghế của lời mời đã có thành viên active (trạng thái bất thường – chốt chặn cuối).
    await asOwner((c) =>
      c.query(
        `INSERT INTO account.memberships (id, account_id, user_id, role, seat, status)
           VALUES ($1, $2, $3, 'collaborator', 1, 'active')`,
        [uuidV7(), owner.accountId, uuidV7()],
      ),
    );
    expect((await acceptInvitationNew(inv)).result).toBe('seat_taken');
    // Đúng một cách đăng nhập: thiếu cả hai → lỗi lập trình.
    await asAppInAccount(owner.accountId, async (c) => {
      await expect(
        c.query(
          `SELECT account.auth_accept_invitation_new($1, $2, $3, $3, $3, 'a', NULL, NULL, NULL, NULL, NULL, 'v')`,
          [inv.invitationId, inv.tokenHash, uuidV7()],
        ),
      ).rejects.toMatchObject({ code: '22023' });
    });
  });

  it('(g) hai lượt chấp nhận đồng thời cùng một lời mời → đúng một accepted', async () => {
    const owner = await verifiedOwner();
    const inv = await seedInvitation(owner);
    const results = await Promise.all([acceptInvitationNew(inv), acceptInvitationNew(inv)]);
    expect(results.map((r) => r.result).sort()).toEqual(['accepted', 'invalid']);
    const users = await ownerRows('SELECT 1 FROM account.users WHERE email_normalized = $1', [
      inv.emailNormalized,
    ]);
    expect(users).toHaveLength(1);
  });

  // ----- (i) gỡ -----
  it('(i) member_detach: detached chuyển người dùng sang tài khoản chờ; not_found; owner', async () => {
    const owner = await verifiedOwner();
    const member = await seedCollaborator(owner, { seat: 1 });
    await seedSession(member);
    expect((await callDetach(owner.accountId, owner.userId, owner.userId)).result).toBe('owner');
    expect((await callDetach(owner.accountId, uuidV7(), owner.userId)).result).toBe('not_found');
    // Không lấy tài khoản từ tham số: gọi trong ngữ cảnh tài khoản KHÁC → not_found.
    const stranger = await verifiedOwner();
    expect((await callDetach(stranger.accountId, member.userId, stranger.userId)).result).toBe(
      'not_found',
    );
    const { result, shellAccountId } = await callDetach(
      owner.accountId,
      member.userId,
      owner.userId,
    );
    expect(result).toBe('detached');
    const state = await ownerRows(
      `SELECT u.account_id, (u.detached_at IS NOT NULL) AS detached, a.status AS account_status,
              (SELECT count(*)::int FROM account.sessions s WHERE s.user_id = u.id) AS sessions,
              (SELECT string_agg(m.account_id::text || ':' || m.role || ':' || m.status, ','
                                 ORDER BY m.role)
                 FROM account.memberships m WHERE m.user_id = u.id) AS memberships,
              (SELECT li.account_id FROM account.login_identities li WHERE li.user_id = u.id) AS li_account,
              (SELECT f.display_name FROM account.former_members f
                WHERE f.account_id = $2 AND f.user_id = u.id) AS former_name
         FROM account.users u JOIN account.accounts a ON a.id = u.account_id
        WHERE u.id = $1`,
      [member.userId, owner.accountId],
    );
    expect(state).toEqual([
      {
        account_id: shellAccountId,
        detached: true,
        account_status: 'unclaimed',
        sessions: 0,
        memberships: `${owner.accountId}:collaborator:removed,${shellAccountId}:owner:active`,
        li_account: shellAccountId,
        former_name: 'Cộng tác viên',
      },
    ]);
    // Gỡ lần hai (đã rời tenant) → not_found, không tạo tài khoản chờ thứ hai.
    expect((await callDetach(owner.accountId, member.userId, owner.userId)).result).toBe(
      'not_found',
    );
    // Không có ngữ cảnh tài khoản → từ chối.
    await withRole('app', async (c) => {
      await expect(
        c.query(`SELECT account.member_detach($1, $2, $3, $4, $5)`, [
          member.userId,
          uuidV7(),
          uuidV7(),
          uuidV7(),
          owner.userId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  // ----- (h) chấp nhận – người đã có -----
  it('(h) auth_accept_invitation_existing: accepted chuyển người dùng (cùng userId), kể cả người đã nhận thư báo trước', async () => {
    const formerOwner = await verifiedOwner();
    const loose = await seedDetachedUser(formerOwner, {
      detachedAgo: '85 days',
      noticeAgo: '1 day',
    });
    await seedSession(loose);
    const inviter = await verifiedOwner();
    const inv = await seedInvitation(inviter, { seat: 2, emailNormalized: loose.emailNormalized });
    expect(await acceptExisting(inv.invitationId, loose.userId)).toBe('accepted');
    const state = await ownerRows(
      `SELECT u.account_id, u.detached_at, u.deletion_notice_sent_at,
              (SELECT count(*)::int FROM account.sessions s WHERE s.user_id = u.id) AS sessions,
              (SELECT li.account_id FROM account.login_identities li WHERE li.user_id = u.id) AS li_account,
              (SELECT m.role || ':' || m.seat || ':' || m.status FROM account.memberships m
                WHERE m.user_id = u.id AND m.account_id = u.account_id) AS membership,
              (SELECT count(*)::int FROM account.accounts a WHERE a.id = $2) AS shell_left,
              (SELECT status FROM account.invitations i WHERE i.id = $3) AS inv_status
         FROM account.users u WHERE u.id = $1`,
      [loose.userId, loose.accountId, inv.invitationId],
    );
    expect(state).toEqual([
      {
        account_id: inviter.accountId,
        detached_at: null,
        deletion_notice_sent_at: null,
        sessions: 0,
        li_account: inviter.accountId,
        membership: 'collaborator:2:active',
        shell_left: 0,
        inv_status: 'accepted',
      },
    ]);
    // Dòng 'removed' ở tài khoản cũ và tên trong former_members của tài khoản cũ còn nguyên.
    const old = await ownerRows(
      `SELECT (SELECT status FROM account.memberships WHERE account_id = $1 AND user_id = $2) AS m,
              (SELECT count(*)::int FROM account.former_members WHERE account_id = $1 AND user_id = $2) AS f`,
      [formerOwner.accountId, loose.userId],
    );
    expect(old).toEqual([{ m: 'removed', f: 1 }]);
  });

  it('(h) tham gia lại ĐÚNG tài khoản cũ: kích hoạt lại dòng removed, xóa former_members', async () => {
    const owner = await verifiedOwner();
    const loose = await seedDetachedUser(owner);
    const inv = await seedInvitation(owner, { seat: 2, emailNormalized: loose.emailNormalized });
    expect(await acceptExisting(inv.invitationId, loose.userId)).toBe('accepted');
    const rows = await ownerRows(
      `SELECT (SELECT string_agg(role || ':' || seat || ':' || status, ',') FROM account.memberships
                WHERE user_id = $2) AS memberships,
              (SELECT count(*)::int FROM account.former_members WHERE account_id = $1 AND user_id = $2) AS f`,
      [owner.accountId, loose.userId],
    );
    expect(rows).toEqual([{ memberships: 'collaborator:2:active', f: 0 }]);
  });

  it('(h) auth_accept_invitation_existing: invalid | email_mismatch | not_eligible | seat_taken', async () => {
    const formerOwner = await verifiedOwner();
    const loose = await seedDetachedUser(formerOwner);
    const inviter = await verifiedOwner();
    // invalid: không tồn tại, không pending, quá hạn, tài khoản mời deleting.
    expect(await acceptExisting(uuidV7(), loose.userId)).toBe('invalid');
    const cancelled = await seedInvitation(inviter, {
      emailNormalized: loose.emailNormalized,
      status: 'cancelled',
    });
    expect(await acceptExisting(cancelled.invitationId, loose.userId)).toBe('invalid');
    const expired = await seedInvitation(inviter, {
      emailNormalized: loose.emailNormalized,
      expires: '-1 minute',
    });
    expect(await acceptExisting(expired.invitationId, loose.userId)).toBe('invalid');
    await asOwner((c) =>
      c.query('DELETE FROM account.invitations WHERE id = $1', [expired.invitationId]),
    );
    const dying = await verifiedOwner();
    const fromDying = await seedInvitation(dying, { emailNormalized: loose.emailNormalized });
    await asOwner((c) =>
      c.query(`UPDATE account.accounts SET status = 'deleting' WHERE id = $1`, [dying.accountId]),
    );
    expect(await acceptExisting(fromDying.invitationId, loose.userId)).toBe('invalid');
    // email_mismatch: lời mời cho email khác; hoặc email của người dùng chưa xác minh.
    const forOther = await seedInvitation(inviter, { seat: 1 });
    expect(await acceptExisting(forOther.invitationId, loose.userId)).toBe('email_mismatch');
    const mine = await seedInvitation(inviter, { seat: 2, emailNormalized: loose.emailNormalized });
    await asOwner((c) =>
      c.query('UPDATE account.users SET email_verified_at = NULL WHERE id = $1', [loose.userId]),
    );
    expect(await acceptExisting(mine.invitationId, loose.userId)).toBe('email_mismatch');
    await markVerified(loose.userId);
    // not_eligible: người đang thuộc tài khoản thật; người không tồn tại.
    const settled = await verifiedOwner();
    const liveInv = await seedInvitation(await verifiedOwner(), {
      emailNormalized: settled.emailNormalized,
    });
    expect(await acceptExisting(liveInv.invitationId, settled.userId)).toBe('not_eligible');
    expect(await acceptExisting(mine.invitationId, uuidV7())).toBe('not_eligible');
    // seat_taken: ghế của lời mời đã có thành viên active.
    await asOwner((c) =>
      c.query(
        `INSERT INTO account.memberships (id, account_id, user_id, role, seat, status)
           VALUES ($1, $2, $3, 'collaborator', 2, 'active')`,
        [uuidV7(), inviter.accountId, uuidV7()],
      ),
    );
    expect(await acceptExisting(mine.invitationId, loose.userId)).toBe('seat_taken');
    // Không nhánh thất bại nào đổi người dùng.
    const u = await ownerRows<{ account_id: string }>(
      'SELECT account_id FROM account.users WHERE id = $1',
      [loose.userId],
    );
    expect(u[0]?.account_id).toBe(loose.accountId);
  });

  // ----- (j) đến hạn -----
  it('(j) detached_users_due: mốc notice = retention − notice, purge = retention và notice ngày sau thư', async () => {
    const owner = await verifiedOwner();
    const fresh = await seedDetachedUser(owner, { detachedAgo: '82 days' });
    const owner2 = await verifiedOwner();
    const dueNotice = await seedDetachedUser(owner2, { detachedAgo: '84 days' });
    const owner3 = await verifiedOwner();
    const noticedRecently = await seedDetachedUser(owner3, {
      detachedAgo: '95 days',
      noticeAgo: '3 days',
    });
    const owner4 = await verifiedOwner();
    const duePurge = await seedDetachedUser(owner4, {
      detachedAgo: '91 days',
      noticeAgo: '8 days',
    });
    const due = (kind: string, retention: number, notice: number) =>
      withRole('system', async (c) => {
        const r = await c.query<{ user_id: string }>(
          `SELECT * FROM account.detached_users_due($1, 1000, $2, $3)`,
          [kind, retention, notice],
        );
        return new Set(r.rows.map((row) => row.user_id));
      });
    const notice = await due('notice', 90, 7);
    expect(notice.has(dueNotice.userId)).toBe(true);
    expect(notice.has(fresh.userId)).toBe(false);
    expect(notice.has(noticedRecently.userId)).toBe(false);
    expect(notice.has(duePurge.userId)).toBe(false);
    const purge = await due('purge', 90, 7);
    expect(purge.has(duePurge.userId)).toBe(true);
    expect(purge.has(noticedRecently.userId)).toBe(false);
    expect(purge.has(dueNotice.userId)).toBe(false);
    // Bộ tham số khác (30/3): người 82 ngày chưa báo → đến hạn báo; người báo 3 ngày trước → đến hạn xóa.
    expect((await due('notice', 30, 3)).has(fresh.userId)).toBe(true);
    expect((await due('purge', 30, 3)).has(noticedRecently.userId)).toBe(true);
    // Giới hạn số dòng và tham số sai.
    await withRole('system', async (c) => {
      const limited = await c.query(`SELECT * FROM account.detached_users_due('notice', 1, 30, 3)`);
      expect(limited.rows).toHaveLength(1);
      await expect(
        c.query(`SELECT * FROM account.detached_users_due('other', 1, 90, 7)`),
      ).rejects.toMatchObject({ code: '22023' });
    });
  });

  // ----- (k) xóa -----
  it('(k) purge_detached_account: active / chưa đủ ngày → false; đủ điều kiện → xóa, dòng removed ở tài khoản cũ còn nguyên', async () => {
    const purge = (accountId: string, retention = 90, notice = 7) =>
      withRole('system', async (c) => {
        const r = await c.query<{ ok: boolean }>(
          `SELECT account.purge_detached_account($1, $2, $3) AS ok`,
          [accountId, retention, notice],
        );
        return r.rows[0]?.ok;
      });
    const owner = await verifiedOwner();
    expect(await purge(owner.accountId)).toBe(false);
    const tooEarly = await seedDetachedUser(owner, { detachedAgo: '89 days', noticeAgo: '8 days' });
    expect(await purge(tooEarly.accountId)).toBe(false);
    const owner2 = await verifiedOwner();
    const noticeTooRecent = await seedDetachedUser(owner2, {
      detachedAgo: '95 days',
      noticeAgo: '3 days',
    });
    expect(await purge(noticeTooRecent.accountId)).toBe(false);
    const owner3 = await verifiedOwner();
    const notNoticed = await seedDetachedUser(owner3, { detachedAgo: '95 days' });
    expect(await purge(notNoticed.accountId)).toBe(false);
    for (const u of [tooEarly, noticeTooRecent, notNoticed]) {
      expect(await ownerRows('SELECT 1 FROM account.users WHERE id = $1', [u.userId])).toHaveLength(
        1,
      );
    }
    const owner4 = await verifiedOwner();
    const due = await seedDetachedUser(owner4, { detachedAgo: '91 days', noticeAgo: '8 days' });
    await seedSession(due);
    expect(await purge(due.accountId)).toBe(true);
    const left = await ownerRows(
      `SELECT (SELECT count(*)::int FROM account.accounts WHERE id = $1) AS accounts,
              (SELECT count(*)::int FROM account.users WHERE id = $2) AS users,
              (SELECT count(*)::int FROM account.login_identities WHERE user_id = $2) AS identities,
              (SELECT count(*)::int FROM account.sessions WHERE user_id = $2) AS sessions,
              (SELECT string_agg(status, ',') FROM account.memberships WHERE user_id = $2) AS memberships,
              (SELECT count(*)::int FROM account.former_members WHERE user_id = $2) AS former`,
      [due.accountId, due.userId],
    );
    expect(left).toEqual([
      { accounts: 0, users: 0, identities: 0, sessions: 0, memberships: 'removed', former: 1 },
    ]);
    expect(await purge(due.accountId)).toBe(false);
  });

  // ----- (l) dọn dẹp -----
  it('(l) auth_housekeeping: hết hạn lời mời (trả đúng danh sách, lần hai rỗng), xóa lời mời đóng > 90 ngày và former_members > 12 tháng', async () => {
    const owner = await verifiedOwner();
    const overdue = await seedInvitation(owner, { seat: 1, expires: '-1 minute' });
    const live = await seedInvitation(owner, { seat: 2 });
    const oldClosed = await seedInvitation(owner, { status: 'cancelled', closedAgo: '91 days' });
    const recentClosed = await seedInvitation(owner, { status: 'cancelled', closedAgo: '10 days' });
    await asOwner((c) =>
      c.query(
        `INSERT INTO account.former_members (id, account_id, user_id, display_name, removed_at, removed_by_user_id)
         VALUES ($1, $3, $1, 'cũ', now() - interval '13 months', $4),
                ($2, $3, $2, 'mới', now() - interval '11 months', $4)`,
        [uuidV7(), uuidV7(), owner.accountId, owner.userId],
      ),
    );
    const run = () =>
      withRole('system', async (c) => {
        const r = await c.query<{ account_id: string; invitation_id: string }>(
          `SELECT * FROM account.auth_housekeeping()`,
        );
        return r.rows.filter((row) => row.account_id === owner.accountId);
      });
    expect(await run()).toEqual([
      { account_id: owner.accountId, invitation_id: overdue.invitationId },
    ]);
    expect(await run()).toEqual([]);
    const invs = await ownerRows<{ id: string; status: string; closed: boolean }>(
      `SELECT id, status, (closed_at IS NOT NULL) AS closed FROM account.invitations WHERE account_id = $1`,
      [owner.accountId],
    );
    const byId = new Map(invs.map((i) => [i.id, i]));
    expect(byId.get(overdue.invitationId)).toMatchObject({ status: 'expired', closed: true });
    expect(byId.get(live.invitationId)).toMatchObject({ status: 'pending', closed: false });
    expect(byId.has(oldClosed.invitationId)).toBe(false);
    expect(byId.has(recentClosed.invitationId)).toBe(true);
    const former = await ownerRows<{ display_name: string }>(
      'SELECT display_name FROM account.former_members WHERE account_id = $1',
      [owner.accountId],
    );
    expect(former.map((f) => f.display_name)).toEqual(['mới']);
  });
  it('(n) auth_invitation_account: chỉ trả tài khoản của lời mời pending, chưa quá hạn, tài khoản còn dùng được; system/support không gọi được', async () => {
    const owner = await seedUser();
    const live = await seedInvitation(owner, { seat: 1 });
    const expired = await seedInvitation(owner, { seat: 2, expires: '-1 minute' });
    const q = 'SELECT account.auth_invitation_account($1) AS account_id';
    const ask = (id: string) =>
      withRole('app', async (c) => (await c.query<{ account_id: string | null }>(q, [id])).rows);
    // Đúng một cột, đúng mã tài khoản.
    expect(await ask(live.invitationId)).toEqual([{ account_id: owner.accountId }]);
    expect(await ask(expired.invitationId)).toEqual([{ account_id: null }]);
    expect(await ask(uuidV7())).toEqual([{ account_id: null }]);
    await asOwner((c) =>
      c.query(`UPDATE account.accounts SET status = 'deleting' WHERE id = $1`, [owner.accountId]),
    );
    expect(await ask(live.invitationId)).toEqual([{ account_id: null }]);
    for (const role of ['system', 'support'] as const) {
      await withRole(role, async (c) => {
        await expect(c.query(q, [live.invitationId])).rejects.toMatchObject({ code: '42501' });
      });
    }
  });
});
