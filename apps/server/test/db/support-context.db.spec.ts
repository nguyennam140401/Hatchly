// US4-AS3..AS5, SC-007, FR-023: vai trò support chỉ đọc khung nhìn; mỗi lần xem = 1 dòng kiểm toán.
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors/app-error';
import { supportSearch, supportViewAccount } from '../../src/core/db/support';
import { TenantContextError } from '../../src/core/db/errors';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import {
  asOwner,
  createAccount,
  dbUrls,
  describeDb,
  makeDatabase,
  seedNotes,
  type TestDatabase,
} from './helpers/db';

async function auditRows(staffId: string) {
  return asOwner(
    async (c) =>
      (
        await c.query<{
          account_id: string | null;
          actor_type: string;
          action: string;
          keyword_type: string | null;
          reason: string | null;
          metadata: unknown;
        }>(
          `SELECT account_id, actor_type, action, keyword_type, reason, metadata
           FROM infra.audit_log WHERE actor_id = $1 ORDER BY occurred_at`,
          [staffId],
        )
      ).rows,
  );
}

describeDb('Ngữ cảnh hỗ trợ (supportSearch, supportViewAccount)', () => {
  let database: TestDatabase;
  let a: string;
  let b: string;
  let staff: { staffId: string };

  beforeAll(async () => {
    database = makeDatabase({ unit: 'api' });
    a = await createAccount();
    b = await createAccount();
    await seedNotes(a, 2, 'nội dung A');
    await seedNotes(b, 1, 'nội dung B');
  });
  beforeEach(() => {
    staff = { staffId: `nv-${uuidV7()}` };
  });
  afterAll(async () => {
    await database.close();
  });

  it('support SELECT trực tiếp bảng gốc → 42501', async () => {
    const c = new Client({ connectionString: dbUrls.support });
    await c.connect();
    try {
      const err = await c.query('SELECT * FROM sandbox.tenant_notes').catch((e: unknown) => e);
      expect((err as { code?: string }).code).toBe('42501');
      const err2 = await c.query('SELECT * FROM account.accounts').catch((e: unknown) => e);
      expect((err2 as { code?: string }).code).toBe('42501');
    } finally {
      await c.end();
    }
  });

  it('supportViewAccount(A) đọc khung nhìn chi tiết → chỉ dòng A, không có secret_note; 1 dòng kiểm toán', async () => {
    const rows = await supportViewAccount(
      staff,
      a,
      'Khách báo lỗi đăng bài',
      async (db) => (await db.execute(sql`SELECT * FROM sandbox.support_note_detail`)).rows,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.account_id === a)).toBe(true);
    expect(Object.keys(rows[0]!)).not.toContain('secret_note');
    expect(await auditRows(staff.staffId)).toEqual([
      {
        account_id: a,
        actor_type: 'support',
        action: 'support.view_account',
        keyword_type: null,
        reason: 'Khách báo lỗi đăng bài',
        metadata: null,
      },
    ]);
  });

  it('supportSearch thấy A và B nhưng chỉ cột account_id, object_id, status; kiểm toán ghi LOẠI từ khóa', async () => {
    const rows = await supportSearch(
      staff,
      'post_id',
      async (db) => (await db.execute(sql`SELECT * FROM sandbox.support_note_search`)).rows,
    );
    const accountsSeen = new Set(rows.map((r) => r.account_id));
    expect(accountsSeen.has(a) && accountsSeen.has(b)).toBe(true);
    expect(Object.keys(rows[0]!).sort()).toEqual(['account_id', 'object_id', 'status']);
    const audit = await auditRows(staff.staffId);
    expect(audit).toEqual([
      {
        account_id: null,
        actor_type: 'support',
        action: 'support.search',
        keyword_type: 'post_id',
        reason: null,
        metadata: null,
      },
    ]);
  });

  it('fn ném lỗi → không có kết quả và không có dòng kiểm toán', async () => {
    await expect(
      supportViewAccount(staff, a, 'Kiểm tra lỗi', async () => {
        throw new Error('lỗi giữa chừng');
      }),
    ).rejects.toThrow('lỗi giữa chừng');
    await expect(
      supportSearch(staff, 'email', async () => {
        throw new Error('lỗi giữa chừng');
      }),
    ).rejects.toThrow('lỗi giữa chừng');
    expect(await auditRows(staff.staffId)).toEqual([]);
  });

  it('lý do < 5 ký tự → lỗi trước khi chạm CSDL', async () => {
    const before = database.service.pool('support')!.totalCount;
    const err = await supportViewAccount(staff, a, ' abc ', async () => 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('VALIDATION_FAILED');
    expect(database.service.pool('support')!.totalCount).toBe(before);
    expect(await auditRows(staff.staffId)).toEqual([]);
  });

  it('tài khoản không tồn tại → TENANT_NOT_FOUND, không ghi kiểm toán', async () => {
    const err = await supportViewAccount(staff, uuidV7(), 'Tra cứu thử', async () => 1).catch(
      (e: unknown) => e,
    );
    expect((err as TenantContextError).code).toBe('TENANT_NOT_FOUND');
    expect(await auditRows(staff.staffId)).toEqual([]);
  });

  it('không cấu hình bể support → SERVICE_UNAVAILABLE', async () => {
    const worker = makeDatabase({ unit: 'worker' });
    try {
      const err = await supportSearch(staff, 'email', async () => 1).catch((e: unknown) => e);
      expect((err as AppError).code).toBe('SERVICE_UNAVAILABLE');
    } finally {
      await worker.close();
      database = makeDatabase({ unit: 'api' });
    }
  });
});
