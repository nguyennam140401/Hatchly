import { createHash, randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { asOwner, dbUrls } from './db';

// Dữ liệu mồi cho kiểm thử xác thực (004) ở mức CSDL: đăng ký qua chính `account.auth_register`
// bằng vai trò `app` (đường thật), chỉnh trạng thái bằng `owner`.

export interface SeededUser {
  accountId: string;
  userId: string;
  emailNormalized: string;
  verifyTokenHash: Buffer;
}

export function sha256(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Kết nối mới bằng một vai trò (người gọi phải `end()`). */
export async function roleClient(role: 'app' | 'system' | 'support' | 'owner'): Promise<Client> {
  const client = new Client({ connectionString: dbUrls[role], options: '-c TimeZone=UTC' });
  await client.connect();
  return client;
}

export async function withRole<T>(
  role: 'app' | 'system' | 'support' | 'owner',
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const client = await roleClient(role);
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export function uniqueEmail(prefix = 'u'): string {
  return `${prefix}.${randomBytes(6).toString('hex')}@example.test`;
}

/** Gọi `auth_register` bằng `app` trên một kết nối có sẵn; trả kết quả hàm. */
export async function callRegister(
  client: Client,
  input: { emailNormalized: string; ids?: Partial<SeededUser> & { tokenHash?: Buffer } },
): Promise<{ result: string; user: SeededUser }> {
  const accountId = input.ids?.accountId ?? uuidV7();
  const userId = input.ids?.userId ?? uuidV7();
  const tokenHash = input.ids?.tokenHash ?? sha256(randomBytes(32));
  const r = await client.query<{ result: string }>(
    `SELECT account.auth_register($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now() + interval '1 day') AS result`,
    [
      accountId,
      userId,
      uuidV7(),
      uuidV7(),
      uuidV7(),
      'Người thử',
      input.emailNormalized,
      input.emailNormalized,
      '$argon2id$v=19$m=64,t=1,p=1$c2FsdHNhbHQ$aGFzaA',
      '2026-11',
      tokenHash,
    ],
  );
  return {
    result: r.rows[0]?.result ?? '',
    user: { accountId, userId, emailNormalized: input.emailNormalized, verifyTokenHash: tokenHash },
  };
}

/** Đăng ký một người dùng (chủ tài khoản) bằng `app`. */
export async function seedUser(email = uniqueEmail()): Promise<SeededUser> {
  return withRole('app', async (c) => {
    const { result, user } = await callRegister(c, { emailNormalized: email });
    if (result !== 'created') throw new Error(`seedUser: ${result}`);
    return user;
  });
}

/** Chèn một phiên bằng `owner`; trả băm mã. */
export async function seedSession(
  user: SeededUser,
  opts: { idle?: string; absolute?: string; revoked?: boolean; lastSeen?: string } = {},
): Promise<{ sessionId: string; tokenHash: Buffer }> {
  const sessionId = uuidV7();
  const tokenHash = sha256(randomBytes(32));
  await asOwner((c) =>
    c.query(
      `INSERT INTO account.sessions (id, account_id, user_id, token_hash, last_seen_at,
         idle_expires_at, absolute_expires_at, revoked_at, revoke_reason)
       VALUES ($1, $2, $3, $4, now() + $5::interval, now() + $6::interval, now() + $7::interval,
         CASE WHEN $8 THEN now() END, CASE WHEN $8 THEN 'logout' END)`,
      [
        sessionId,
        user.accountId,
        user.userId,
        tokenHash,
        opts.lastSeen ?? '0 seconds',
        opts.idle ?? '14 days',
        opts.absolute ?? '30 days',
        opts.revoked === true,
      ],
    ),
  );
  return { sessionId, tokenHash };
}

// ---------------------------------------------------------------------------------------------
// 009: đăng nhập qua nhà cung cấp, lời mời, tài khoản chờ – mồi qua chính các hàm SECURITY DEFINER
// bằng vai trò `app` (đường thật); chỉnh thời gian/trạng thái bằng `owner`.
// ---------------------------------------------------------------------------------------------

/** Chạy `fn` bằng `app` trong một giao dịch có ngữ cảnh tài khoản (như tenantTx). */
export async function asAppInAccount<T>(
  accountId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return withRole('app', async (c) => {
    await c.query('BEGIN');
    try {
      await c.query(`SELECT set_config('app.account_id', $1, true)`, [accountId]);
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    }
  });
}

/** Đánh dấu email đã xác minh (bằng `owner`). */
export async function markVerified(userId: string): Promise<void> {
  await asOwner((c) =>
    c.query('UPDATE account.users SET email_verified_at = now() WHERE id = $1', [userId]),
  );
}

export interface OAuthRegisterInput {
  provider?: 'google' | 'facebook';
  subject?: string;
  emailNormalized?: string;
  emailVerified?: boolean;
  ids?: { accountId?: string; userId?: string };
}

/** Gọi `auth_register_oauth` bằng `app` trên kết nối có sẵn. */
export async function callRegisterOAuth(
  client: Client,
  input: OAuthRegisterInput = {},
): Promise<{ result: string; user: SeededUser; subject: string }> {
  const accountId = input.ids?.accountId ?? uuidV7();
  const userId = input.ids?.userId ?? uuidV7();
  const email = input.emailNormalized ?? uniqueEmail('oauth');
  const subject = input.subject ?? `sub-${randomBytes(8).toString('hex')}`;
  const r = await client.query<{ result: string }>(
    `SELECT account.auth_register_oauth($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $6, $5, '2026-11')
       AS result`,
    [
      accountId,
      userId,
      uuidV7(),
      uuidV7(),
      'Người thử',
      email,
      input.emailVerified ?? true,
      input.provider ?? 'google',
      subject,
    ],
  );
  return {
    result: r.rows[0]?.result ?? '',
    user: { accountId, userId, emailNormalized: email, verifyTokenHash: Buffer.alloc(0) },
    subject,
  };
}

export interface SeededInvitation {
  invitationId: string;
  accountId: string;
  token: string;
  tokenHash: Buffer;
  emailNormalized: string;
  seat: number;
}

/** Chèn một lời mời bằng `owner` (bỏ qua giới hạn thư); `expires` là khoảng tính từ bây giờ. */
export async function seedInvitation(
  owner: SeededUser,
  opts: {
    emailNormalized?: string;
    seat?: number;
    expires?: string;
    status?: 'pending' | 'accepted' | 'cancelled' | 'expired';
    closedAgo?: string;
    label?: string | null;
  } = {},
): Promise<SeededInvitation> {
  const invitationId = uuidV7();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  const emailNormalized = opts.emailNormalized ?? uniqueEmail('invite');
  const seat = opts.seat ?? 1;
  const status = opts.status ?? 'pending';
  await asOwner((c) =>
    c.query(
      `INSERT INTO account.invitations (id, account_id, email, email_normalized, invited_by_user_id,
         seat, status, token_hash, account_label, last_sent_at, expires_at, closed_at)
       VALUES ($1, $2, $3, $3, $4, $5, $6::text, $7, $8, now(), now() + $9::interval,
         CASE WHEN $6::text <> 'pending' THEN now() - $10::interval END)`,
      [
        invitationId,
        owner.accountId,
        emailNormalized,
        owner.userId,
        seat,
        status,
        tokenHash,
        opts.label === undefined ? 'Tiệm thử' : opts.label,
        opts.expires ?? '7 days',
        opts.closedAgo ?? '0 seconds',
      ],
    ),
  );
  return { invitationId, accountId: owner.accountId, token, tokenHash, emailNormalized, seat };
}

/** Gọi `auth_accept_invitation_new` (nhánh mật khẩu) bằng `app` trong ngữ cảnh tài khoản mời. */
export async function acceptInvitationNew(
  inv: SeededInvitation,
  opts: { provider?: 'google' | 'facebook'; subject?: string; userId?: string } = {},
): Promise<{ result: string; userId: string }> {
  const userId = opts.userId ?? uuidV7();
  const result = await asAppInAccount(inv.accountId, async (c) => {
    const r = await c.query<{ result: string }>(
      `SELECT account.auth_accept_invitation_new($1, $2, $3, $4, $5, 'Cộng tác viên', $6, $7, $8, $9,
         $10, '2026-11') AS result`,
      [
        inv.invitationId,
        inv.tokenHash,
        userId,
        uuidV7(),
        uuidV7(),
        opts.provider === undefined ? '$argon2id$v=19$m=64,t=1,p=1$c2FsdHNhbHQ$aGFzaA' : null,
        opts.provider ?? null,
        opts.provider === undefined ? null : (opts.subject ?? `sub-${userId}`),
        opts.provider === undefined ? null : inv.emailNormalized,
        opts.provider === undefined ? null : 'Tên phía nhà cung cấp',
      ],
    );
    return r.rows[0]?.result ?? '';
  });
  return { result, userId };
}

/** Mồi một cộng tác viên đã xác minh qua lời mời + chấp nhận (đường thật). */
export async function seedCollaborator(
  owner: SeededUser,
  opts: { seat?: number; emailNormalized?: string } = {},
): Promise<SeededUser> {
  const inv = await seedInvitation(owner, opts);
  const { result, userId } = await acceptInvitationNew(inv);
  if (result !== 'accepted') throw new Error(`seedCollaborator: ${result}`);
  return {
    accountId: owner.accountId,
    userId,
    emailNormalized: inv.emailNormalized,
    verifyTokenHash: Buffer.alloc(0),
  };
}

/** Gọi `member_detach` bằng `app` trong ngữ cảnh tài khoản `accountId`. */
export async function callDetach(
  accountId: string,
  userId: string,
  byUserId: string,
): Promise<{ result: string; shellAccountId: string }> {
  const shellAccountId = uuidV7();
  const result = await asAppInAccount(accountId, async (c) => {
    const r = await c.query<{ result: string }>(
      `SELECT account.member_detach($1, $2, $3, $4, $5) AS result`,
      [userId, shellAccountId, uuidV7(), uuidV7(), byUserId],
    );
    return r.rows[0]?.result ?? '';
  });
  return { result, shellAccountId };
}

/**
 * Mồi một người ở tài khoản chờ: cộng tác viên của `owner` rồi bị gỡ. `detachedAgo` / `noticeAgo` lùi
 * mốc thời gian (vd '91 days', '8 days').
 */
export async function seedDetachedUser(
  owner: SeededUser,
  opts: { detachedAgo?: string; noticeAgo?: string; emailNormalized?: string } = {},
): Promise<SeededUser & { formerAccountId: string }> {
  const collaborator = await seedCollaborator(
    owner,
    opts.emailNormalized === undefined ? {} : { emailNormalized: opts.emailNormalized },
  );
  const { result, shellAccountId } = await callDetach(
    owner.accountId,
    collaborator.userId,
    owner.userId,
  );
  if (result !== 'detached') throw new Error(`seedDetachedUser: ${result}`);
  if (opts.detachedAgo !== undefined || opts.noticeAgo !== undefined) {
    await asOwner((c) =>
      c.query(
        `UPDATE account.users
            SET detached_at = now() - $2::interval,
                deletion_notice_sent_at = CASE WHEN $3::text IS NULL THEN NULL
                                               ELSE now() - $3::interval END
          WHERE id = $1`,
        [collaborator.userId, opts.detachedAgo ?? '0 seconds', opts.noticeAgo ?? null],
      ),
    );
  }
  return { ...collaborator, accountId: shellAccountId, formerAccountId: owner.accountId };
}
