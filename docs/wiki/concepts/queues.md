---
type: concept
title: Hàng chờ và việc nền (pg-boss)
sources:
  [
    .specify/memory/constitution.md,
    apps/server/docs/queue.md,
    .specify/memory/architecture.md,
    apps/server/src/modules/queue/public-api.ts,
    apps/server/src/modules/queue/jobs.ts,
  ]
updated: 2026-11-14
status: current
related:
  [
    modules/queue.md,
    concepts/tenant-rls.md,
    concepts/publish-idempotency.md,
    concepts/module-boundaries.md,
  ]
---

# Hàng chờ và việc nền (hiến pháp V, ADR-03)

**Đã hiện thực (003)**. Việc nền nằm trong PostgreSQL (pg-boss 12.38.0, ghim phiên bản, ẩn sau module `queue`); không broker.

- 6 hàng chờ (`QUEUE_NAMES`): `publish`, `media`, `ai_batch`, `trends`, `notify`, `scheduled`; thông số (đồng thời, tối đa
  mỗi tenant, thời gian khóa, thử lại) ở `infra.queue_settings`, đọc lại mỗi 60 giây, đổi không cần phát hành.
- Khai báo bằng `defineJobType` (`<module>.<action>`; `z.strictObject`; chỉ mã tham chiếu; phong bì ≤ 8 192 byte; tên trường
  nhạy cảm bị cấm). Tạo việc bằng `enqueue` **trong cùng giao dịch** nghiệp vụ; khóa chống trùng `dedupeKey`.
- Phong bì `{type, v, accountId, traceId, payload}`; `group_id` = mã tài khoản; Worker đặt lại ngữ cảnh tenant trước khi gọi
  bộ xử lý (`registerJobHandler`, phải chạy lại an toàn). Heartbeat khóa 30 giây.
- Việc hỏng vào `infra.dead_jobs` (hỗ trợ tra/chạy lại); việc định kỳ qua `defineSchedule`, khóa khung bằng
  `infra.schedule_slots` (không dùng `schedule()` của thư viện); nhật ký phân vùng theo tháng.
- Worker tắt có kiểm soát: ngừng lấy việc mới, chờ ≤ 30 giây.
- Đã khai báo trong mã: `context.profile_changed` (`ai_batch`), `notifications.deliver` (`notify`), `ai_gateway.release_stale*`,
  4 việc nội bộ `queue.*`, kiểm tra khói 008. Chưa có: việc `publish`, `media`, `trends` thật.
- Kiểm thử: `pnpm test:queue`, `pnpm test:queue-soak`.

## Nguồn

- apps/server/docs/queue.md
- .specify/memory/architecture.md (mục 6)
