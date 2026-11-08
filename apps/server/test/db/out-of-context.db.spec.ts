// US1-AS6, FR-008: truy vấn bảng khách hàng ngoài ngữ cảnh tenant.
// development/test → lỗi nêu bảng; staging/production → 0 dòng + một cảnh báo có cấu trúc.
import { ne } from 'drizzle-orm';
import { beforeAll, expect, it } from 'vitest';
import { TenantContextError } from '../../src/core/db/errors';
import { systemTx } from '../../src/core/db/transaction';
import { createAccount, describeDb, makeDatabase, rawAppPool, seedNotes } from './helpers/db';
import { tenantNotes } from './sandbox/schema';

describeDb('Truy vấn ngoài ngữ cảnh tenant', () => {
  beforeAll(async () => {
    await seedNotes(await createAccount(), 2);
  });

  it('APP_ENV=test: systemTx không tenant đọc tenant_notes → TENANT_CONTEXT_MISSING nêu bảng', async () => {
    const database = makeDatabase({ appEnv: 'test' });
    try {
      const err = await systemTx((db) => db.select().from(tenantNotes)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TenantContextError);
      expect((err as TenantContextError).code).toBe('TENANT_CONTEXT_MISSING');
      expect((err as TenantContextError).message).toContain('sandbox.tenant_notes');
    } finally {
      await database.close();
    }
  });

  it('APP_ENV=production: trả 0 dòng và đúng một warn db.tenant_context_missing, không có dữ liệu', async () => {
    const database = makeDatabase({ appEnv: 'production' });
    try {
      // Tham số có giá trị nhận diện – không được lọt vào nhật ký.
      const rows = await systemTx((db) =>
        db.select().from(tenantNotes).where(ne(tenantNotes.title, 'GIA_TRI_THAM_SO_BI_MAT')),
      );
      expect(rows).toEqual([]);
      const warns = database.logs.entries.filter((e) => e.event === 'db.tenant_context_missing');
      expect(warns).toHaveLength(1);
      expect(warns[0]).toMatchObject({ level: 'warn', table: 'sandbox.tenant_notes' });
      expect(JSON.stringify(database.logs.entries)).not.toContain('GIA_TRI_THAM_SO_BI_MAT');
      expect(Object.keys(warns[0]!).sort()).toEqual(['event', 'level', 'table', 'trace_id']);
    } finally {
      await database.close();
    }
  });

  it('truy vấn tự xác nhận trực tiếp trên vai trò app (đường thô của kiểm thử) → 0 dòng', async () => {
    const pool = rawAppPool();
    try {
      const r = await pool.query('SELECT * FROM sandbox.tenant_notes');
      expect(r.rowCount).toBe(0);
    } finally {
      await pool.end();
    }
  });
});
