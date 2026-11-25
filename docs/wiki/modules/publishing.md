---
type: module
title: Module publishing (Đăng bài)
sources:
  [
    apps/server/src/modules/modules.manifest.json,
    apps/server/src/modules/publishing/public-api.ts,
    apps/server/src/modules/publishing/index.ts,
    .specify/memory/architecture.md,
  ]
updated: 2026-11-25
status: draft
related:
  [
    concepts/publish-idempotency.md,
    modules/platform_gateway.md,
    concepts/queues.md,
    features/013-publish-five-steps.md,
  ]
---

# publishing – Đăng bài

> **Cập nhật 012:** Từ 012: bảng `publish_attempts` (mục lịch đăng, chỉ mục duy nhất chống đăng trùng), `PublishingPublicApi` (schedule/cancel/reschedule/statuses/precheck), việc `publishing.run_attempt` với bộ thực thi tạm. Xem [012](../features/012-manual-compose-approval-calendar.md).

> **Cập nhật 014:** bước 2 "chuẩn bị media" của 013 dùng `MEDIA_PUBLIC_API.getPublishableMedia` bản thật (đường dẫn công khai có hạn, `format` dạng ngắn); không còn bản giữ chỗ. Xem [014](../features/014-media-library-basic.md).

> **Cập nhật 013 (2026-11-25):** module đã hiện thực thật: bộ thực thi 5 bước, máy trạng thái, "Đăng lại", "Đã đăng", Tiến trình đăng. Chưa kiểm chứng với nền tảng thật (T085). Xem [013](../features/013-publish-five-steps.md).

## Trách nhiệm

Lượt đăng (tối đa một lượt hiệu lực mỗi cặp bài–kênh), hẹn giờ chung, 5 bước đăng, phân loại lỗi, đối soát, "Cần kiểm tra", "Đăng lại"; module duy nhất được gọi `platform_gateway` (FR-07–10).

## Schema/bảng

Schema `publishing`: `publish_attempts` (chỉ mục duy nhất một phần theo `(account_id, post_id, connection_id) WHERE status <> 'cancelled'`), `publish_steps` (nhật ký phân vùng tháng, chỉ thêm, giữ 12 tháng), `error_mappings` (ánh xạ mã lỗi nền tảng). Chi tiết: `specs/013-publish-five-steps/data-model.md`.

## Giao diện công khai

`PublishingPublicApi`: tạo/hủy/đổi giờ lượt đăng, đọc trạng thái (cho `approval`). Điểm cuối HTTP cho web: `GET /api/posts/{postId}/publish-progress`, `POST /api/publish-attempts/{id}/republish`, `…/mark-published`, `GET …/support-details`. Mọi chuyển trạng thái đi qua `transition()` trong `internal/state-machine.ts`.

## Phụ thuộc cho phép

`content`, `media`, `platform_gateway`, `notifications`, `queue`.

## Chạy ở

api + worker (hàng chờ `publish`).

## Tính năng liên quan

[001](../features/001-monorepo-module-skeleton.md) (dựng khung), [012](../features/012-manual-compose-approval-calendar.md) (lịch đăng), [013](../features/013-publish-five-steps.md) (đăng 5 bước).

## Nguồn

- apps/server/src/modules/modules.manifest.json
- apps/server/src/modules/publishing/public-api.ts
- .specify/memory/architecture.md (mục 4)
