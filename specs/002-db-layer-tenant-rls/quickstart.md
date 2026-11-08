# Quickstart – kiểm chứng lớp CSDL (002)

Kịch bản chạy tay để chứng minh tính năng hoạt động. Lệnh và biến: `contracts/db-commands.md`. Hành vi
mong đợi: `contracts/db-layer-api.md`, `contracts/db-conventions.md`.

## 0. Chuẩn bị

- Đã có khung 001 (`pnpm install`, `pnpm verify` đạt), Docker Desktop (Windows) hoặc Docker Engine.
- `Copy-Item apps/server/.env.example apps/server/.env` (PowerShell) hoặc `cp` (Linux) – có sẵn
  `DATABASE_*` trỏ vào compose.

## 1. Dựng CSDL và cấu trúc (US2)

```powershell
pnpm db:up          # PostgreSQL cục bộ
pnpm db:setup       # bootstrap 4 vai trò + migrate (gồm sandbox vì APP_ENV=development)
pnpm db:setup       # chạy lại
```

Mong đợi: lần 1 in số migration đã áp và kết thúc ≤ 1 phút (SC-004); lần 2 in "0 migration mới", mã 0.
Kiểm tra bằng `docker compose exec postgres psql -U postgres -d app`:

- `\dn` → đúng 11 schema của tệp kê khai + `sandbox` (+ `public`).
- `\du` → `owner`, `app`, `system`, `support`; không vai trò nào có `Bypass RLS`/`Superuser`.
- `\dp sandbox.*` → `support` chỉ có quyền trên hai khung nhìn, không có trên `tenant_notes`.

## 2. Kiểm tra quy ước (US3)

```powershell
pnpm db:check                 # → "0 vi phạm", mã 0
```

Thử một vi phạm: trong `psql` với vai trò `owner` tạo
`CREATE TABLE content.tmp (id uuid primary key, account_id uuid not null);` → `pnpm db:check` báo
`a-rls-missing` và `j-unregistered-table` cho `content.tmp`, mã 1. Xóa bảng, chạy lại → đạt.

## 3. Cô lập tenant (US1, US4)

```powershell
$env:TEST_DATABASE_ADMIN_URL = 'postgres://postgres:postgres_dev_only@localhost:5432/postgres'
pnpm test:db
```

Bộ kiểm thử tạo CSDL tạm, rồi khẳng định (mỗi dòng ↔ một nhóm kiểm thử):

| Kịch bản | Mong đợi |
|---|---|
| Ngữ cảnh A đọc `sandbox.tenant_notes` không lọc | chỉ dòng của A (US1-AS1) |
| Ngữ cảnh A sửa/xóa toàn bảng | chỉ dòng của A thay đổi (US1-AS2) |
| Ngữ cảnh A chèn/sửa dòng thành `account_id = B` | lỗi `DB_POLICY_VIOLATION`, hoàn tác (US1-AS3) |
| Bể 1 kết nối: giao dịch A (thành công rồi lỗi) → truy vấn không ngữ cảnh | 0 dòng (US1-AS4) |
| A và B song song trên 2 kết nối | không rò (US1-AS5) |
| `systemTx` không tenant đọc bảng mẫu, `APP_ENV=test` / `production` | lỗi nêu `sandbox.tenant_notes` / 0 dòng + nhật ký `db.tenant_context_missing` (US1-AS6, US4-AS1) |
| Mã tài khoản rỗng / sai UUID / không tồn tại; lồng khác tài khoản | `TENANT_CONTEXT_INVALID` / `TENANT_NOT_FOUND` / `TENANT_CONTEXT_CONFLICT` |
| Hai giao dịch cập nhật cùng `version` | một thành công, một `VERSION_CONFLICT` (US3-AS5) |
| `support` đọc bảng gốc / khung nhìn | bị từ chối / được; mỗi lần gọi đúng 1 dòng `infra.audit_log` (US4-AS3..5, SC-007) |
| `app` chạy `SET ROLE owner`, `ALTER TABLE … DISABLE ROW LEVEL SECURITY`, `SET row_security = off` + SELECT | đều bị CSDL từ chối (US4-AS6) |
| Xóa `account.accounts` A (bằng `owner`) | mọi dòng của A ở bảng `tenant` biến mất; `infra.audit_log` giữ nguyên |
| 1.000 vòng giao dịch xen kẽ A/B (gồm hoàn tác) trên bể 2 kết nối | 0 rò (SC-002) |
| Đo p95 thời gian thêm do đặt ngữ cảnh | ≤ 5 ms (SC-006, in ra kết quả) |
| Mỗi tệp `fixtures/conventions/*.sql` | `db:check` phát hiện đúng quy tắc (SC-003) |
| Quét nhật ký và thông báo lỗi của toàn bộ lần chạy | không có mật khẩu/chuỗi kết nối (SC-008) |

## 4. Chạy cả hệ thống bằng compose

```powershell
docker compose up --build -d
docker compose ps                          # migrate: exited (0); api, worker: healthy
curl http://localhost:3000/readyz          # checks có { "name": "database", "status": "pass" }
docker compose stop postgres; curl http://localhost:3000/readyz   # 503, database: fail
docker compose start postgres
```

Thử sai cấu hình: đặt `DATABASE_APP_URL` trỏ vào vai trò `owner` → API thoát khi khởi động với thông
báo "vai trò CSDL không hợp lệ cho ứng dụng" (không in mật khẩu).

## 5. Kiểm tra toàn kho

```powershell
pnpm verify      # có TEST_DATABASE_ADMIN_URL: thêm db:lint-migrations, test:db đạt
                 # không có: test:db hiện "bỏ qua (chưa có CSDL kiểm thử)"
```

## 6. Thêm một bảng khách hàng mới (SC-005)

Làm theo `apps/server/docs/database.md` mục "Thêm bảng khách hàng": khai báo bằng `tenantTable` trong
`modules/<m>/internal/db/schema.ts` → `pnpm db:generate` → review SQL → `pnpm db:migrate` →
`pnpm db:check` đạt → thêm bảng vào khuôn kiểm thử truy cập chéo. Mục tiêu ≤ 15 phút.

## Kết quả chạy (2026-11-08, Windows 10, Docker 29, PostgreSQL 17)

Compose chạy với tệp ghi đè cổng tạm (13000/13001/18080/15432) vì compose của checkout chính đang
dùng 3000/3001/8080.

| Mục | Kết quả |
|---|---|
| 1. `pnpm db:setup` ×2 | Lần 1: 5 migration chính + 2 dev, 0,1 s; lần 2: "0 migration mới", mã 0. 11 schema + `sandbox`, 4 vai trò không Superuser/Bypass RLS, `support` chỉ có quyền trên 2 khung nhìn |
| 2. `pnpm db:check` | "ĐẠT: 0 vi phạm"; thêm `content.tmp` → `a-rls-missing` + `j-unregistered-table`, mã 1 |
| 3. `pnpm test:db` | 17 tệp, 84 kiểm thử đạt (gồm 1.000 vòng không rò, SC-006: chênh p95 0,69 ms) |
| 4. compose | `migrate` exited (0); api, worker healthy; `/readyz` 200 `database: pass`; dừng postgres → 503 `checks_failed:database`; bật lại → 200; `DATABASE_APP_URL` vai trò owner → `db.role_invalid`, mã 1, không in mật khẩu; `node dist/db/check-conventions.js` trong ảnh → ĐẠT (bỏ qua sandbox) |
| 5. `pnpm verify` | Không có `TEST_DATABASE_ADMIN_URL`: ĐẠT 7/7 (test:db bỏ qua); có: ĐẠT 8/8 |
| 6. Thêm bảng (SC-005) | ~5 phút, xem `apps/server/docs/database.md` mục "Lịch sử diễn tập" |

Phát hiện khi chạy: `.dockerignore` mẫu `**/*.log*` loại nhầm `audit-log.log-table.ts` → đã thêm
ngoại lệ `!**/*.log-table.ts`.
