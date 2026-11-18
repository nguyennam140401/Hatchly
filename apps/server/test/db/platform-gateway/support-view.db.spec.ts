// 010 T034 (FR-030): khung nhìn hỗ trợ `platform_gateway.support_channel_view` – chỉ đọc qua supportViewAccount,
// lọc đúng tài khoản được xem, KHÔNG có cột bản mã; support không đọc thẳng bảng gốc; mỗi lần xem có kiểm toán.
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { supportViewAccount } from '../../../src/core/db/support';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import {
  asOwner,
  createAccount,
  dbUrls,
  describeDb,
  makeDatabase,
  type TestDatabase,
} from '../helpers/db';

describeDb('Khung nhìn hỗ trợ kênh kết nối', () => {
  let database: TestDatabase;
  let a: string;
  let b: string;

  /** Mồi một kết nối bằng owner (bản mã giả – không phải mã quyền thật). */
  async function seed(accountId: string, name: string): Promise<void> {
    await asOwner((c) =>
      c.query(
        `INSERT INTO platform_gateway.channel_connections
           (id, account_id, channel_type, external_id, display_name, token_ciphertext, refresh_ciphertext,
            token_issued_at, expiry_kind, token_expires_at, connected_at)
         VALUES ($1, $2, 'facebook_page', $3, $4, $5, $6, now(), 'token', now() + interval '1 day', now())`,
        [
          uuidV7(),
          accountId,
          `page-${randomBytes(6).toString('hex')}`,
          name,
          randomBytes(40),
          randomBytes(40),
        ],
      ),
    );
  }

  beforeAll(async () => {
    database = makeDatabase({ unit: 'api' });
    a = await createAccount();
    b = await createAccount();
    await seed(a, 'Page của A');
    await seed(b, 'Page của B');
  });
  afterAll(async () => {
    await database.close();
  });

  it('support SELECT thẳng bảng gốc → 42501 (từ chối quyền)', async () => {
    const c = new Client({ connectionString: dbUrls.support });
    await c.connect();
    try {
      const err = await c
        .query('SELECT * FROM platform_gateway.channel_connections')
        .catch((e: unknown) => e);
      expect((err as { code?: string }).code).toBe('42501');
    } finally {
      await c.end();
    }
  });

  it('supportViewAccount(A) chỉ thấy kết nối của A, không có cột *_ciphertext; có 1 dòng kiểm toán', async () => {
    const staff = { staffId: `nv-${uuidV7()}` };
    const rows = await supportViewAccount(
      staff,
      a,
      'Khách báo kênh không đăng được',
      async (db) =>
        (await db.execute(sql`SELECT * FROM platform_gateway.support_channel_view`)).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.account_id).toBe(a);
    expect(rows[0]?.display_name).toBe('Page của A');
    const columns = Object.keys(rows[0] ?? {});
    expect(columns.filter((col) => col.includes('ciphertext'))).toEqual([]);
    expect(columns).not.toContain('granted_scopes');

    const audit = await asOwner(
      async (c) =>
        (
          await c.query<{ action: string; account_id: string }>(
            'SELECT action, account_id FROM infra.audit_log WHERE actor_id = $1',
            [staff.staffId],
          )
        ).rows,
    );
    expect(audit).toEqual([{ action: 'support.view_account', account_id: a }]);
    expect(b).not.toBe(a);
  });
});
