// Nhóm (c) – truy cập chéo TỰ NHẬN DIỆN bảng mới (006 R13, FR-023, cổng CI số 1 của hiến pháp).
// Nạp lược đồ của MỌI module như `db:check`, rồi: (1) mỗi bảng `tenant` trong sổ đăng ký phải có fixture
// hoặc nằm trong danh sách miễn trừ – thiếu → đỏ, thông điệp chỉ tên bảng; (2) chạy khuôn
// `describeCrossTenant` (đọc/sửa/xóa/chèn chéo × 2 chiều) cho mọi fixture.
// Chép mẫu này khi: KHÔNG cần chép – chỉ thêm fixture cho bảng mới vào cross-tenant-fixtures.ts.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import '../../src/core/db/tenant-root';
import { tableRegistry } from '../../src/core/db/table-registry';
import { CROSS_TENANT_EXEMPT, CROSS_TENANT_FIXTURES } from './fixtures/cross-tenant-fixtures';
import { describeCrossTenant } from './helpers/cross-tenant';
import './sandbox/schema';

const MODULES_DIR = join(__dirname, '..', '..', 'src', 'modules');
for (const mod of readdirSync(MODULES_DIR)) {
  const schemaFile = join(MODULES_DIR, mod, 'internal', 'db', 'schema.ts');
  if (existsSync(schemaFile)) await import(pathToFileURL(schemaFile).href);
}

describe('Bao phủ kiểm thử truy cập chéo (006 R13)', () => {
  it('mọi bảng tenant đều có fixture hoặc lý do miễn trừ', () => {
    const tenantTables = [...tableRegistry().values()]
      .filter((t) => t.kind === 'tenant')
      .map((t) => `${t.schema}.${t.name}`);
    const missing = tenantTables.filter(
      (name) => !(name in CROSS_TENANT_FIXTURES) && !(name in CROSS_TENANT_EXEMPT),
    );
    expect(
      missing,
      `Bảng tenant chưa có kiểm thử truy cập chéo – thêm mục vào test/db/fixtures/cross-tenant-fixtures.ts: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('fixture không trỏ tới bảng không còn tồn tại', () => {
    const known = new Set([...tableRegistry().keys()]);
    const stale = Object.keys(CROSS_TENANT_FIXTURES).filter((name) => !known.has(name));
    expect(stale).toEqual([]);
  });
});

for (const fixture of Object.values(CROSS_TENANT_FIXTURES)) describeCrossTenant(fixture);
