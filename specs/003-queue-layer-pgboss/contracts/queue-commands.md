# Hợp đồng: lệnh, biến môi trường, điểm kiểm tra của lớp hàng chờ

## 1. Lệnh mới (`package.json` gốc chuyển tiếp tới `@app/server`)

| Lệnh | Việc | Mã thoát |
|---|---|---|
| `pnpm queue:sql --construct` | In SQL dựng schema `pgboss` của bản pg-boss cố định (để tạo migration tay 0005) | 0 |
| `pnpm queue:sql --migrate-from <version>` | In SQL nâng schema `pgboss` từ phiên bản cũ (cho lần nâng pg-boss sau) | 0 / 1 sai tham số |
| `pnpm test:queue` | Kiểm thử tích hợp hàng chờ trên PostgreSQL thật (`TEST_DATABASE_ADMIN_URL`) | 0 / 1 |
| `pnpm test:queue-soak` | Bộ chịu tải SC-001/004/006 (≈ 10 phút, không chạy mặc định) | 0 / 1 |

Lệnh có sẵn đổi hành vi:

- `pnpm db:migrate`: sau migration Drizzle chạy `ensureQueues` (vai trò `owner`): tạo 6 hàng chờ nếu chưa
  có, đồng bộ thông số từ `infra.queue_settings`. Idempotent.
- `pnpm db:check`: thêm schema `pgboss` vào danh sách ngoài module; kiểm `pgboss.job_common` có RLS; tôn
  trọng `nullableTenant` của `infra.dead_jobs`.
- `pnpm check:boundaries`: quy tắc `pgboss-only-in-queue` (chỉ `apps/server/src/modules/queue/internal/**`
  và `apps/server/src/db/**` nhập `pg-boss`); `cron-parser` chỉ trong `modules/queue/internal/**`.
- `pnpm verify`: thêm `test:queue` sau `test:db`.

## 2. Biến môi trường mới (`AppConfigSchema`)

| Biến | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|
| `QUEUE_ENABLED` | `true` | boolean | `false`: Worker khởi động không lấy việc (gỡ lỗi) |
| `QUEUE_CONTROL_POOL_MAX` | `6` | 2–20 | bể điều khiển (vai trò `system`, chỉ Worker) |
| `QUEUE_API_POOL_MAX` | `2` | 1–5 | bể của thể hiện pg-boss phía API (vai trò `app`, chỉ đọc bộ nhớ đệm) |
| `QUEUE_SETTINGS_REFRESH_MS` | `60000` | 10 000–300 000 | ≤ 5 phút (FR-006) |
| `QUEUE_SCHEDULER_TICK_MS` | `10000` | 1 000–30 000 | nhịp bộ hẹn giờ |

Không có biến bí mật mới (dùng lại `DATABASE_APP_URL`, `DATABASE_SYSTEM_URL`). Khuyến nghị Worker đặt
`DATABASE_POOL_MAX` ≥ 20 (tổng đồng thời/bản = 26; bộ xử lý không giữ kết nối khi gọi API ngoài).

## 3. Điểm kiểm tra của Worker (`WORKER_HEALTH_PORT`)

| Đường dẫn | 200 | 503 |
|---|---|---|
| `GET /healthz` (có sẵn) | tiến trình sống | đang tắt |
| `GET /readyz` (mới – FR-019) | `{ status: 'ready', checks: [{ name: 'database' }, { name: 'queue' }] }` | một kiểm tra `fail`: mất CSDL, lấy việc/heartbeat lỗi > 30 giây, `schemaVersion` lệch, đang tắt |

Kubernetes: `livenessProbe` → `/healthz`, `readinessProbe` → `/readyz` (WBS 1.5).
