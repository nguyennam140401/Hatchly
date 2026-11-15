---
type: howto
title: Thêm module hoặc tính năng nghiệp vụ
sources:
  [
    README.md,
    docs/sample-module.md,
    apps/server/src/modules/modules.manifest.json,
    apps/server/docs/database.md,
    apps/server/docs/queue.md,
    apps/server/docs/auth.md,
  ]
updated: 2026-11-14
status: current
related:
  [
    concepts/module-boundaries.md,
    concepts/tenant-rls.md,
    concepts/queues.md,
    concepts/auth-rbac.md,
    modules/context.md,
  ]
---

# Thêm module

Quy trình đầy đủ: README.md mục 8; mẫu chép từ đầu tới cuối: `docs/sample-module.md` (module `context`, tính năng 006).

1. Thêm mục vào `apps/server/src/modules/modules.manifest.json` (`name` snake_case, `title`, `kind`, `schema` riêng, `runsIn`,
   `allowedDeps`); module khác cần dùng thì thêm tên vào `allowedDeps` của nó. **Cần review.**
2. Tạo `apps/server/src/modules/<name>/`: `index.ts` (export `<Name>Module` + kiểu công khai), `<name>.module.ts`, `public-api.ts`
   (`<Name>PublicApi`), `internal/` (phần còn lại), `jobs.ts` nếu có việc nền.
3. Thêm `<name>: <Name>Module` vào `MODULE_REGISTRY` ở `apps/server/src/app/module-registry.ts` (khởi động báo lỗi nếu lệch manifest).
4. Tạo `packages/shared/src/modules/<name>/index.ts` cho hợp đồng web <-> API (nhập bằng `@app/shared/<name>`).
5. `pnpm verify`.

Khi viết nghiệp vụ: bảng khách hàng dùng `tenantTable` + `tenantTx` (database.md); việc nền dùng `defineJobType`/`enqueue`
trong cùng giao dịch (queue.md); mỗi route khai báo `@CustomerAccess`/`@StaffAccess`/`@Public` (auth.md). Thêm bảng: xem
[add-migration](add-migration.md). Không sửa module có sẵn khi thêm module mới.

## Nguồn

- README.md (mục 8), docs/sample-module.md
