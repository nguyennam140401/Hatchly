# Quickstart: kiểm chứng lớp hàng chờ (003)

Hướng dẫn chạy và kiểm chứng; chi tiết giao diện ở [contracts/queue-api.md](contracts/queue-api.md),
dữ liệu ở [data-model.md](data-model.md).

## 1. Chuẩn bị

```powershell
pnpm install
Copy-Item apps/server/.env.example apps/server/.env   # nếu chưa có; cần DATABASE_SYSTEM_URL cho Worker
pnpm db:up
pnpm db:setup          # vai trò + migration (gồm 0005 pgboss, infra.queue_settings, dead_jobs…) + ensureQueues
pnpm db:check          # → ĐẠT: 0 vi phạm (pgboss.job_common có RLS, dead_jobs nullableTenant)
$env:TEST_DATABASE_ADMIN_URL = 'postgres://postgres:postgres_dev_only@localhost:5432/postgres'
```

Không chạy `docker compose` ở hai checkout cùng lúc (cổng 3000/3001/8080).

## 2. Chạy Worker và nhìn trạng thái

```powershell
pnpm dev:worker
# nhật ký: queue.started { queues: [publish, media, ai_batch, trends, notify, scheduled], version }
curl http://localhost:3001/readyz     # 200, checks database + queue = pass
```

Dừng PostgreSQL (`docker compose stop postgres`) → trong ≤ 30 giây `/readyz` trả 503, Worker không thoát,
nhật ký `queue.fetch_failed` giãn cách; bật lại → `/readyz` 200 (FR-019).

## 3. Kiểm thử tích hợp

```powershell
pnpm test:queue
```

| Tệp (`apps/server/test/queue/`) | Chứng minh | Spec |
|---|---|---|
| `enqueue-tx.queue.spec.ts` | hoàn tác → không việc (200 lần); xác nhận → việc mang `accountId`, `traceId`; ngữ cảnh sai bị từ chối; lô tất cả-hoặc-không | US1, FR-007…013, SC-005 |
| `dedupe-reschedule.queue.spec.ts` | khóa trùng → `exists`; hủy/đổi giờ chỉ khi chờ; `runAfter` tương lai không bị lấy | US1 AS3–5 |
| `payload-rules.queue.spec.ts` | trường bị cấm, > 8 KB, sai khuôn, `publish` với `allowGenericRetry` | FR-012, Q1 |
| `worker-context.queue.spec.ts` | bộ xử lý thấy đúng tenant / ngữ cảnh hệ thống; nhật ký có `account_id`, `trace_id` | US2 AS1–2, FR-014 |
| `retry-dead.queue.spec.ts` | giãn cách + ngẫu nhiên ≤ 20%; `retryAfter`; `noRetry`; `PermanentJobError`; không có bộ xử lý → hỏng sau hết lượt; `onFinalFailure` | US2 AS3–5, FR-015/016/020, Q2 |
| `no-double-run.queue.spec.ts` | 2 bản, 500 việc: mỗi việc đúng một lần thành công, 0 chồng lấn | US2, SC-002 |
| `crash-recovery.queue.spec.ts` | tiến trình con bị `SIGKILL` giữa việc → việc chạy lại sau heartbeat, lượt tính thêm | US2 AS6, FR-017 |
| `tenant-limit.queue.spec.ts` | 2 bản, `media` 1/tenant: A ≤ 1 tại mọi lần lấy mẫu; B bắt đầu không chờ A; việc hệ thống không tính | US3, FR-021/022 |
| `priority.queue.spec.ts` | `media` đầy việc dài → `publish` đến giờ bắt đầu ≤ 30 giây | US2 AS8, SC-003 |
| `shutdown.queue.spec.ts` | SIGTERM khi đang chạy: ngừng lấy, chờ ≤ 30 giây, thoát ≤ 35 giây; không ghi "xong" sai | FR-018, SC-008 |
| `dead-jobs-support.queue.spec.ts` | tra cứu qua khung nhìn + kiểm toán; chạy lại → việc mới cùng khóa, lần 2 không trùng; `publish` bị từ chối; tenant A không thấy việc hỏng của B | US4, FR-023…025, SC-009 |
| `schedule.queue.spec.ts` | 2 bản, lịch 6 trường "mỗi 2 giây" × 15 khung: đúng một lần/khung; chồng → `skipped_overlap`; thứ Hai 05:00 UTC+7 → 22:00 UTC Chủ nhật; không bù hàng loạt | US5, FR-026…028 |
| `maintenance.queue.spec.ts` | dọn việc hỏng > 90 ngày, khung > 90 ngày; tạo phân vùng tháng kế tiếp, chạy lại không lỗi | US5 AS5–6, FR-029 |
| `settings.queue.spec.ts` | đổi đồng thời trong CSDL → áp dụng ở lần đọc kế tiếp; giá trị sai → giữ cũ + `queue.settings_invalid` | US6 AS3, FR-006, SC-010 |
| `metrics.queue.spec.ts` | đủ 6 chỉ số theo hàng chờ, không có nhãn `account_id` | US6 AS1, FR-031 |
| `purge-account.queue.spec.ts` | xóa mọi việc + việc hỏng của A, không chạm B; việc đang chạy bị hủy, không thử lại | FR-037 |
| `queue-privileges.queue.spec.ts` | `app` không thấy việc tenant khác / việc hệ thống; `support` không có quyền `pgboss` | R12, nguyên tắc I |
| `secrets-in-logs.queue.spec.ts` | quét nhật ký + `dead_jobs.last_error` của toàn bộ bộ kiểm thử | SC-011 |

Kiểm thử đơn vị trong `pnpm test`: tính khung lịch (`slot`), lịch giãn cách, lược bí mật, kiểm khuôn tên
trường, `ops/alerts/queue.rules.yml` đủ 10 quy tắc (FR-032).

## 4. Bộ chịu tải (trước khi hợp nhất)

```powershell
pnpm test:queue-soak
```

Kỳ vọng: SC-001 (1 000 việc, 5 lần giết ngẫu nhiên → 100% xong/hỏng có lý do, không kẹt > khóa + 1 phút),
SC-002 (0 chồng lấn), SC-004 (tài khoản ồn ào 50 việc `media` + 5 tài khoản × 2: giới hạn không vượt, 5 tài
khoản bắt đầu trước khi tài khoản ồn ào xong 25%), SC-006 (60 khung, 0 trùng, 0 bỏ khi còn một bản),
SC-007 (tạo việc p95 ≤ 10 ms – in bảng đo).

## 5. Diễn tập cho lập trình viên module (SC-012, ≤ 30 phút)

Theo `apps/server/docs/queue.md`: khai báo `sandbox.echo` (`defineJobType`), bộ xử lý ghi một dòng
`sandbox.tenant_notes`, tạo việc trong `tenantTx`, viết kiểm thử `expectIdempotent`, chạy `pnpm test:queue`.
Ghi thời gian vào bảng "Lịch sử diễn tập" của tài liệu.
