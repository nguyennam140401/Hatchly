# Hợp đồng: lệnh và cấu hình CSDL

Giao diện cho lập trình viên, CI (WBS 1.4) và hạ tầng (WBS 1.5). Mọi lệnh chạy được trên Windows và
Linux; không in chuỗi kết nối hay mật khẩu.

## 1. Lệnh

| Lệnh (gốc kho) | Chạy bằng | Làm gì | Mã thoát |
|---|---|---|---|
| `pnpm db:up` | Docker | `docker compose up -d postgres` – PostgreSQL cục bộ | của docker |
| `pnpm db:bootstrap` | `DATABASE_ADMIN_URL` | Tạo/cập nhật 4 vai trò, mật khẩu, quyền CSDL (R6). Idempotent | 0 / 1 |
| `pnpm db:migrate` | `DATABASE_OWNER_URL` | Áp migration chính; + migration dev khi `APP_ENV ∈ {development,test}`. Khóa tư vấn, idempotent. In số migration đã áp | 0 / 1 |
| `pnpm db:setup` | cả hai | `db:bootstrap` rồi `db:migrate` (dev) | 0 / 1 |
| `pnpm db:generate` | — | `drizzle-kit generate` (migration chính) | 0 / 1 |
| `pnpm db:generate:custom -- --name <tên>` | — | Tạo tệp SQL tay rỗng có thứ tự | 0 / 1 |
| `pnpm db:generate:dev` | — | `drizzle-kit generate` cho `sandbox` | 0 / 1 |
| `pnpm db:check` | `DATABASE_OWNER_URL` | Kiểm tra quy ước (`db-conventions.md`) | 0 / 1 / 2 |
| `pnpm db:lint-migrations` | — | Quét câu lệnh phá tương thích ngược (R17) | 0 / 1 |
| `pnpm test:db` | `TEST_DATABASE_ADMIN_URL` | Kiểm thử tích hợp CSDL trên CSDL tạm `app_test_<ngẫu nhiên>` | 0 / 1; thiếu biến → 0 + thông báo bỏ qua |
| `pnpm verify` | — | Thêm bước `db:lint-migrations` và `test:db` (bỏ qua có thông báo khi thiếu `TEST_DATABASE_ADMIN_URL`) | như 001 |

Trong ảnh container: `node dist/db/migrate.js`, `node dist/db/bootstrap.js`, `node dist/db/setup-dev.js`,
`node dist/db/check-conventions.js` (Job Kubernetes chạy migrate trước khi cập nhật Deployment – WBS 1.5).

## 2. Biến môi trường

### API / Worker (`AppConfigSchema` mở rộng)

| Biến | Bắt buộc | Mặc định | Bí mật | Ghi chú |
|---|---|---|---|---|
| `DATABASE_APP_URL` | có | — | ✔ | Vai trò `app` |
| `DATABASE_SYSTEM_URL` | Worker: có · API: không | — | ✔ | Vai trò `system`; API không tạo bể này |
| `DATABASE_SUPPORT_URL` | không | — | ✔ | Vai trò `support`; thiếu → thao tác hỗ trợ trả `SERVICE_UNAVAILABLE` |
| `DATABASE_POOL_MAX` | không | `10` | | Mỗi bể |
| `DATABASE_STATEMENT_TIMEOUT_MS` | không | `15000` | | `statement_timeout` |
| `DATABASE_IDLE_IN_TX_TIMEOUT_MS` | không | `30000` | | `idle_in_transaction_session_timeout` |

Thiếu/sai → thoát khi khởi động với thông báo theo FR-006 của 001 (chỉ tên biến + lý do).

### Script CSDL (lược đồ riêng, không nằm trong `AppConfigSchema`)

| Biến | Dùng bởi | Bí mật |
|---|---|---|
| `DATABASE_ADMIN_URL` | `db:bootstrap` | ✔ |
| `DATABASE_OWNER_URL` | `db:migrate`, `db:check` | ✔ |
| `DB_ROLE_PASSWORD_OWNER` / `_APP` / `_SYSTEM` / `_SUPPORT` | `db:bootstrap` | ✔ |
| `DATABASE_NAME` | `db:bootstrap` (mặc định lấy từ `DATABASE_ADMIN_URL`) | |
| `TEST_DATABASE_ADMIN_URL` | `test:db` | ✔ |

`.env.example` có giá trị mẫu cho compose (`*_dev_only`), ghi rõ không dùng ở môi trường thật.

## 3. `docker-compose.yml`

- `postgres`: bỏ `profiles: ['db']`; ảnh `${POSTGRES_IMAGE:-postgres:17-alpine}`.
- `migrate` (mới): `image: app-server:local`, `command: ['node','dist/db/setup-dev.js']`,
  `depends_on: postgres: service_healthy`, `restart: 'no'`.
- `api`, `worker`: thêm biến `DATABASE_*`; `depends_on: migrate: service_completed_successfully`.
- `/readyz` của API có thêm kiểm tra `database`.

## 4. Kiểm tra sẵn sàng

`GET /readyz` (API) thêm `{ "name": "database", "status": "pass" | "fail" }`; `fail` → 503 như 001.
Worker không có `/readyz` (001); Worker khởi động thất bại khi tự kiểm vai trò sai (R7).
