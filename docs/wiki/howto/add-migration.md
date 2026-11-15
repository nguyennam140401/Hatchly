---
type: howto
title: Thêm migration CSDL
sources:
  [
    package.json,
    apps/server/package.json,
    apps/server/docs/database.md,
    docs/ci-cd/backward-compatible-migrations.md,
    specs/002-db-layer-tenant-rls/quickstart.md,
  ]
updated: 2026-11-14
status: current
related: [concepts/migrations.md, concepts/tenant-rls.md, howto/run-tests.md, howto/add-module.md]
---

# Thêm migration

1. Khai báo bảng trong `apps/server/src/modules/<module>/internal/db/schema.ts` bằng `tenantTable` (bảng khách hàng: có
   `account_id`, RLS tự kèm) hoặc `sharedTable` / `partitionedLogTable`; tiền dùng `microUsd`; khóa lạc quan: cột `version`.
   Hướng dẫn từng bước: `apps/server/docs/database.md` ("Thêm bảng khách hàng/dùng chung").
2. Sinh migration: `pnpm db:generate` (từ định nghĩa bảng); SQL tay (RLS, hàm, khung nhìn): `pnpm --filter @app/server db:generate:custom`;
   khung nhìn/dữ liệu chỉ dev: `db:generate:dev` (thư mục `migrations-dev`).
3. Áp dụng cục bộ: `pnpm db:migrate` (hoặc `pnpm db:setup` làm lại vai trò + migration).
4. Kiểm: `pnpm db:check` (quy ước/RLS) -> `pnpm db:lint-migrations` -> `pnpm db:immutable` -> `pnpm test:db`.
5. Đổi cấu trúc có sẵn phải theo mở rộng -> chuyển -> thu hẹp, thu hẹp kèm `-- breaking-ok: <lý do>`
   ([migrations](../concepts/migrations.md)); thêm ca vào `apps/server/test/compat/` nếu đường chính đọc/ghi bảng mới.

Không sửa migration đã có ở `dev` (bị `db:immutable` chặn). `MIGRATION_BASE_REF` mặc định `origin/dev`.

## Nguồn

- apps/server/docs/database.md
- docs/ci-cd/backward-compatible-migrations.md
