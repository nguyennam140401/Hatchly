---
type: feature
title: 003 – Lớp hàng chờ pg-boss
sources:
  [
    specs/003-queue-layer-pgboss/spec.md,
    specs/003-queue-layer-pgboss/plan.md,
    specs/003-queue-layer-pgboss/tasks.md,
    specs/003-queue-layer-pgboss/research.md,
    specs/003-queue-layer-pgboss/data-model.md,
    specs/003-queue-layer-pgboss/contracts/queue-api.md,
    specs/003-queue-layer-pgboss/contracts/queue-commands.md,
    specs/003-queue-layer-pgboss/contracts/queue-observability.md,
    specs/003-queue-layer-pgboss/quickstart.md,
    apps/server/docs/queue.md,
  ]
updated: 2026-11-14
status: current
related:
  [
    modules/queue.md,
    concepts/queues.md,
    concepts/tenant-rls.md,
    concepts/publish-idempotency.md,
    concepts/migrations.md,
  ]
---

# 003 – Lớp hàng chờ pg-boss

## Mục tiêu

Module `queue` là nơi duy nhất dùng pg-boss: tạo việc trong cùng giao dịch với dữ liệu nghiệp vụ,
Worker lấy/chạy lại an toàn, thử lại theo chính sách, việc hỏng vào `infra.dead_jobs`, hẹn giờ định
kỳ chung, quan sát được. Truy vết: WBS 1.3, ADR-03, T3, hiến pháp I, II, IV, V, VIII, IX.

## Mã FR/NFR

FR-001…FR-037 nội bộ spec; NFR tin cậy (không mất việc khi khởi động lại, lệch lịch ≤ 5 phút), giám sát.

- FR-001/002: bọc pg-boss, cố định phiên bản chính xác.
- FR-003…006: đăng ký loại việc, 6 hàng chờ, `publish` ưu tiên cao nhất, thông số trong CSDL.
- FR-007…013: tạo/hủy/đổi giờ việc trong giao dịch, mã tenant từ ngữ cảnh, khóa chống trùng, lô việc.
- FR-014…016: Worker mở ngữ cảnh tenant trước khi xử lý, kết quả bộ xử lý.
- FR-023…025: việc hỏng; FR-026…029: việc định kỳ; FR-031…033: chỉ số, cảnh báo, nhật ký; FR-037: xóa việc theo tài khoản.

## Trạng thái

`tasks.md`: 75/75 việc xong (`specs/003-queue-layer-pgboss/tasks.md`). Đã merge vào `dev`.

## Quyết định chính (`research.md`)

- Cài schema pg-boss bằng migration tay, không để thư viện tự sửa cấu trúc (R2).
- 1 hàng chờ pg-boss cho mỗi hàng chờ nghiệp vụ `publish` · `media` · `ai_batch` · `trends` · `notify`
  · `scheduled`; loại việc nằm trong phong bì dữ liệu; `policy: exclusive` (R3).
- Tạo việc trong giao dịch của lớp CSDL (R4); dữ liệu việc chỉ chứa mã tham chiếu + tham số nhỏ (R13).
- Khóa việc: heartbeat 30 s + trần cứng; bộ chạy tự quản dưới khóa tư vấn theo hàng chờ (R5, R6).
- Hết lượt thử → `infra.dead_jobs`, quét định kỳ cho việc hết lượt do Worker chết (R8).
- Hẹn giờ định kỳ tự làm trên `infra.schedule_slots` (R9); thông số ở `queue_settings`, đọc lại mỗi 60 s (R10).
- Quan sát: OpenTelemetry API + pino; luật cảnh báo `ops/alerts/queue.rules.yml` (R11).
- Chạy lại việc hỏng: hàm `SECURITY DEFINER` ghi yêu cầu, Worker thực hiện (R14).

## Chạm tới

- Bảng: schema pg-boss, `infra.dead_jobs`, `infra.schedule_slots`, `queue_settings`.
- Hàng chờ: 6 hàng chờ trên; Worker health port `WORKER_HEALTH_PORT` (`contracts/queue-commands.md`).
- API module `queue` (`contracts/queue-api.md`): khai báo loại việc, tạo/hủy/đổi giờ, bộ xử lý, việc hỏng, `queue-test-kit.ts`.
- Mã: `apps/server/src/modules/queue`, guide `apps/server/docs/queue.md`.

## Điểm cần biết khi sửa tiếp

- Mọi bộ xử lý phải idempotent (có thể chạy lại khi khóa hết hạn); không gọi pg-boss ngoài module `queue`.
- Không đưa bí mật/dữ liệu cá nhân vào dữ liệu việc (có kiểm khuôn + lược bí mật).
- Việc tenant luôn mang `account_id` lấy từ ngữ cảnh giao dịch, không từ tham số người gọi.
- Thêm loại việc: đăng ký trong module chủ; thêm hàng chờ mới cần ADR.
- Đây chỉ là hạ tầng; logic đăng bài/AI nằm ở tính năng sau.

## Nguồn

- `specs/003-queue-layer-pgboss/spec.md` · `plan.md` · `tasks.md` · `research.md` · `data-model.md`
- `specs/003-queue-layer-pgboss/contracts/queue-api.md` · `queue-commands.md` · `queue-observability.md`
- `specs/003-queue-layer-pgboss/quickstart.md` · `apps/server/docs/queue.md`
