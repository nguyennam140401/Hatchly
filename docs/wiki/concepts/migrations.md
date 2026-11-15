---
type: concept
title: Migration CSDL tương thích ngược
sources:
  [
    .specify/memory/constitution.md,
    apps/server/docs/database.md,
    docs/ci-cd/backward-compatible-migrations.md,
    docs/ci-cd/rollback.md,
    apps/server/src/db/lint-migrations.ts,
    apps/server/src/db/check-immutable.ts,
  ]
updated: 2026-11-14
status: current
related:
  [concepts/ci-cd.md, concepts/tenant-rls.md, howto/add-migration.md, howto/deploy-and-rollback.md]
---

# Migration CSDL tương thích ngược (hiến pháp - quy trình)

- Khi triển khai, **migration chạy trước** (Job `migrate-<sha12>`), rồi `api` + `worker` thay dần; bản cũ chạy trên cấu trúc mới
  vài phút, và sau khi quay về thì chạy **mãi mãi** - CSDL chỉ đi tới, không hoàn tác.
- Ba bước: **mở rộng** (chỉ thêm) -> **chuyển mã** (ghi cả hai, backfill) -> **thu hẹp** (ở lần phát hành sau, kèm
  `-- breaking-ok: <lý do>` ngay dòng trên câu lệnh).
- `pnpm db:lint-migrations`: chặn `DROP`, `RENAME`, `ALTER COLUMN TYPE`, `SET NOT NULL` trên cột có sẵn, `ADD COLUMN NOT NULL` không
  default, constraint quét cả bảng, `CREATE INDEX` không `CONCURRENTLY`... Chỉ xét migration mới so với `MIGRATION_BASE_REF`
  (mặc định `origin/dev` theo mã; `database.md` còn ghi `main` - đã lỗi thời).
- `pnpm db:immutable`: migration đã có ở nhánh gốc không được sửa; mốc `when` tăng dần (không cho ngoại lệ).
- `pnpm db:compat` / `pnpm test:compat`: chạy bộ kiểm thử hành vi của bản **đang chạy** trên cấu trúc của bản mới. Rủi ro:
  chỉ chứng minh những gì bộ kiểm thử cũ thử - thêm ca vào `apps/server/test/compat/` khi thêm bảng ở đường chính.
- Việc nền loại lạ sau khi quay về được trả lại hàng chờ (không chôn vào `dead_jobs`), xem rollback.md.
- Bảng khách hàng mới phải đủ RLS: xem [tenant-rls](tenant-rls.md).

## Nguồn

- docs/ci-cd/backward-compatible-migrations.md
- apps/server/docs/database.md (mục "Migration tương thích ngược")
