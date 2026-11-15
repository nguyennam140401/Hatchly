---
type: feature
title: 002 – Lớp CSDL, cô lập tenant bằng RLS
sources:
  [
    specs/002-db-layer-tenant-rls/spec.md,
    specs/002-db-layer-tenant-rls/plan.md,
    specs/002-db-layer-tenant-rls/tasks.md,
    specs/002-db-layer-tenant-rls/research.md,
    specs/002-db-layer-tenant-rls/data-model.md,
    specs/002-db-layer-tenant-rls/contracts/db-layer-api.md,
    specs/002-db-layer-tenant-rls/contracts/db-conventions.md,
    specs/002-db-layer-tenant-rls/contracts/db-commands.md,
    specs/002-db-layer-tenant-rls/quickstart.md,
    apps/server/docs/database.md,
  ]
updated: 2026-11-14
status: current
related:
  [
    concepts/tenant-rls.md,
    concepts/migrations.md,
    concepts/module-boundaries.md,
    modules/account.md,
    modules/queue.md,
  ]
---

# 002 – Lớp CSDL, cô lập tenant bằng RLS

## Mục tiêu

Cung cấp cách truy cập PostgreSQL duy nhất cho mọi module, đảm bảo dữ liệu tenant này không bao giờ
lộ sang tenant khác (hiến pháp I): 4 vai trò CSDL, giao dịch có ngữ cảnh tenant, RLS, khuôn bảng,
migration và kiểm tra quy ước. Truy vết: WBS 1.2, ADR-02, ADR-09, ADR-01.

## Mã FR/NFR

FR-001…FR-027 nội bộ spec; NFR bảo mật (cô lập tenant). Nhóm chính:

- FR-001/002/011: vai trò `owner`/`app`/…, `app` không bỏ qua RLS, quyền mặc định.
- FR-003…008: `tenantTx`, từ chối mã tài khoản sai, trả kết nối sạch, phát hiện truy vấn ngoài ngữ cảnh.
- FR-009/010/012: schema theo manifest, migration có thứ tự, tương thích ngược.
- FR-013…: `account.accounts`, bộ cột chuẩn, khóa lạc quan, UUID v7.

## Trạng thái

`tasks.md`: 77/77 việc xong (`specs/002-db-layer-tenant-rls/tasks.md`). Đã merge vào `dev`.

## Quyết định chính (`research.md`)

- Driver `pg`; tự quản giao dịch trên `PoolClient`, Drizzle gắn vào từng giao dịch (R1, R4).
- Biến phiên đặt ở phạm vi giao dịch; chính sách dùng `account.current_account_id()` (R2) – không đọc
  thẳng `app.account_id` (rỗng sau giao dịch).
- Không dùng `FORCE ROW LEVEL SECURITY`; khởi động tự kiểm vai trò (R7).
- Khuôn bảng `tenantTable` / `sharedTable` / `partitionedLogTable` + sổ đăng ký (R8).
- Ngữ cảnh hỗ trợ qua khung nhìn do `owner` sở hữu, không `security_invoker` (R11).
- Migration: drizzle-kit `generate` + SQL tay; trình chạy riêng (R10). Khóa lạc quan bằng cột phiên bản (R13).

## Chạm tới

- Bảng: `account.accounts`; `infra.audit_log` (phân vùng), `infra.schema_migrations`; `sandbox.*` (chỉ dev/test).
- Hàm SQL: `current_account_id()`, `ensure_audit_log_partitions()`.
- API lõi (`contracts/db-layer-api.md`): `tenantTx`, `systemTx`, `support*`, ghi ngữ cảnh vào ExecutionContext.
- Lệnh: `pnpm db:*` gồm `db:check` (`contracts/db-commands.md`); mã ở `apps/server/src/core/db`, `apps/server/src/db`.

## Điểm cần biết khi sửa tiếp

- Module truy cập DB chỉ qua `tenantTx`/`systemTx`/`support*`; không dùng pool trực tiếp.
- Bảng khách hàng mới: `account_id NOT NULL` đầu chỉ mục + RLS, dùng `tenantTable`; `db:check` chặn nếu thiếu.
- Migration chỉ thêm (tương thích ngược); đổi tên/xóa cột cần nhiều bước.
- Tiền micro-USD số nguyên, thời gian `timestamptz` UTC, PK UUID v7.
- Hướng dẫn chi tiết: `apps/server/docs/database.md`.

## Nguồn

- `specs/002-db-layer-tenant-rls/spec.md` · `plan.md` · `tasks.md` · `research.md` · `data-model.md`
- `specs/002-db-layer-tenant-rls/contracts/db-layer-api.md` · `db-conventions.md` · `db-commands.md`
- `specs/002-db-layer-tenant-rls/quickstart.md` · `apps/server/docs/database.md`
