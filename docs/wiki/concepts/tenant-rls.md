---
type: concept
title: Cô lập tenant bằng RLS
sources:
  [
    .specify/memory/constitution.md,
    apps/server/docs/database.md,
    .specify/memory/architecture.md,
    specs/002-db-layer-tenant-rls/quickstart.md,
  ]
updated: 2026-11-14
status: current
related:
  [concepts/auth-rbac.md, concepts/migrations.md, concepts/module-boundaries.md, modules/queue.md]
---

# Cô lập tenant bằng RLS (hiến pháp I)

Tenant = 1 tài khoản khách hàng. Hai lớp chặn: ứng dụng (`tenantTx`) + CSDL (Row-Level Security). **Đã hiện thực** (002).

- Mã tài khoản chỉ lấy từ phiên (guard gọi `bindAccountToRequest`) hoặc dữ liệu việc nền (`runWithJobContext`); `tenantTx` không
  có tham số `accountId`. Trong nghiệp vụ dùng `currentAccountId()`.
- Mọi bảng khách hàng có `account_id NOT NULL` (cột đầu chỉ mục) + chính sách `tenant_isolation`:
  `account_id = account.current_account_id()`. Biến phiên `app.account_id` đặt ở phạm vi **giao dịch**; sau giao dịch nó là
  chuỗi rỗng, nên luôn gọi hàm `account.current_account_id()` (có `nullif`), không `current_setting(...)::uuid`.
- Bốn vai trò CSDL: `owner` (migration), `app` (API/Worker), `system` (Worker, việc dùng chung), `support` (khung nhìn lọc).
  Tương ứng `chu_so_huu`/`ung_dung` trong hiến pháp.
- Khai báo bảng: `tenantTable`, `sharedTable`, `partitionedLogTable`; giao dịch: `tenantTx`, `systemTx`, `supportSearch`,
  `supportViewAccount` (từ `core`, chi tiết ở database.md).
- Việc nền mang `accountId` trong phong bì; Worker đặt lại ngữ cảnh trước khi xử lý (xem [queues](queues.md)).
- Kiểm tra: `pnpm db:check` (quy ước), `pnpm test:db` (truy cập chéo). Tệp media dưới `tenants/{mã}/` (thiết kế, `media` chưa có mã).

**Chưa có**: khung nhìn hỗ trợ thật cho từng module (mẫu ở `apps/server/drizzle/migrations-dev/0001_support_views.sql`).

## Nguồn

- apps/server/docs/database.md
- .specify/memory/constitution.md (nguyên tắc I)
