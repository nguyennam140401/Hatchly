// Nhóm (c) – truy cập chéo TỰ NHẬN DIỆN bảng mới (006 R13, FR-023, cổng CI số 1 của hiến pháp).
// 008 (FR-014, SC-008, R10): danh sách bảng lấy từ CATALOG của CSDL tạm đã migrate – mọi bảng có cột
// `account_id` trong các schema của tệp kê khai module – thay cho sổ đăng ký trong mã, để bảng tạo bằng
// SQL tay cũng không lọt. (1) mỗi bảng phải có fixture hoặc nằm trong danh sách miễn trừ kèm lý do –
// thiếu → đỏ, thông điệp chỉ tên bảng; (2) chạy khuôn `describeCrossTenant` (đọc/sửa/xóa/chèn chéo × 2
// chiều) cho mọi fixture. Mỗi lần chạy in "đã phủ N / tổng M bảng".
// Chép mẫu này khi: KHÔNG cần chép – chỉ thêm fixture cho bảng mới vào cross-tenant-fixtures.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import '../../src/core/db/tenant-root';
import { CROSS_TENANT_EXEMPT, CROSS_TENANT_FIXTURES } from './fixtures/cross-tenant-fixtures';
import { describeCrossTenant } from './helpers/cross-tenant';
import { asOwner, describeDb } from './helpers/db';
import './sandbox/schema';

const manifestSchemas = (
  JSON.parse(readFileSync(resolve('src/modules/modules.manifest.json'), 'utf8')) as {
    modules: { schema: string }[];
  }
).modules.map((m) => m.schema);
// `sandbox`: schema mẫu chỉ có ở development/test – vẫn kiểm để khuôn mẫu không bị bỏ quên.
const SCHEMAS = [...new Set([...manifestSchemas, 'sandbox'])];

/** Mọi bảng (thường hoặc phân vùng gốc) có cột `account_id` – đọc từ catalog. */
async function tenantTablesFromCatalog(): Promise<string[]> {
  return asOwner(async (c) => {
    const r = await c.query<{ name: string }>(
      `SELECT n.nspname || '.' || c.relname AS name
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE a.attname = 'account_id' AND a.attnum > 0 AND NOT a.attisdropped
          AND c.relkind IN ('r', 'p') AND NOT c.relispartition
          AND n.nspname = ANY($1)
        ORDER BY 1`,
      [SCHEMAS],
    );
    return r.rows.map((row) => row.name);
  });
}

describeDb('Bao phủ kiểm thử truy cập chéo (006 R13, 008 FR-014)', () => {
  let tables: string[] = [];
  beforeAll(async () => {
    tables = await tenantTablesFromCatalog();
  });

  it('mọi bảng có account_id trong catalog đều có fixture hoặc lý do miễn trừ', () => {
    // Catalog phải thấy ít nhất các bảng đã biết – nếu rỗng là truy vấn sai, không phải "đã phủ hết".
    expect(tables).toContain('account.memberships');
    const missing = tables.filter(
      (name) => !(name in CROSS_TENANT_FIXTURES) && !(name in CROSS_TENANT_EXEMPT),
    );
    const covered = tables.length - missing.length;
    console.log(
      `Truy cập chéo: đã phủ ${covered} / tổng ${tables.length} bảng ` +
        `(${Object.keys(CROSS_TENANT_FIXTURES).filter((n) => tables.includes(n)).length} fixture, ` +
        `${Object.keys(CROSS_TENANT_EXEMPT).filter((n) => tables.includes(n)).length} có spec riêng)`,
    );
    expect(
      missing,
      `Bảng có account_id chưa có kiểm thử truy cập chéo – thêm mục vào test/db/fixtures/cross-tenant-fixtures.ts: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('mục miễn trừ nào cũng ghi lý do (trỏ tới tệp spec riêng)', () => {
    const noReason = Object.entries(CROSS_TENANT_EXEMPT)
      .filter(([, reason]) => reason.trim().length < 10)
      .map(([name]) => name);
    expect(noReason).toEqual([]);
  });

  it('fixture và mục miễn trừ không trỏ tới bảng không còn tồn tại', async () => {
    // Bảng gốc tenant (account.accounts) khóa bằng `id`, không có cột account_id → so với MỌI bảng của schema.
    const all = await asOwner(async (c) => {
      const r = await c.query<{ name: string }>(
        `SELECT n.nspname || '.' || c.relname AS name FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY($1)`,
        [SCHEMAS],
      );
      return r.rows.map((row) => row.name);
    });
    const known = new Set(all);
    const stale = [
      ...Object.keys(CROSS_TENANT_FIXTURES),
      ...Object.keys(CROSS_TENANT_EXEMPT),
    ].filter((name) => !known.has(name));
    expect(stale).toEqual([]);
  });
});

for (const fixture of Object.values(CROSS_TENANT_FIXTURES)) describeCrossTenant(fixture);
