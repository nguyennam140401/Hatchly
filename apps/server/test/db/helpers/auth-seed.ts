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
