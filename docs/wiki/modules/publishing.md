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
updated: 2026-11-18
status: draft
related: [concepts/publish-idempotency.md, modules/platform_gateway.md, concepts/queues.md]
---

# publishing – Đăng bài

> **Cập nhật 012:** Từ 012: bảng `publish_attempts` (mục lịch đăng, chỉ mục duy nhất chống đăng trùng), `PublishingPublicApi` (schedule/cancel/reschedule/statuses/precheck), việc `publishing.run_attempt` với bộ thực thi tạm; 5 bước thật ở 013. Xem [012](../features/012-manual-compose-approval-calendar.md). Các mục dưới đây là mô tả cũ của 001 và cần rà lại.

> **Cập nhật 014:** bước 2 "chuẩn bị media" của 013 dùng `MEDIA_PUBLIC_API.getPublishableMedia` bản thật (đường dẫn công khai có hạn, `format` dạng ngắn); không còn bản giữ chỗ. Xem [014](../features/014-media-library-basic.md).

## Trách nhiệm

Lượt đăng (tối đa một lượt hiệu lực mỗi cặp bài–kênh), hẹn giờ chung, 5 bước đăng, phân loại lỗi, đối soát, "Cần kiểm tra"; module duy nhất được gọi `platform_gateway` (FR-06–10).

## Schema/bảng

Schema `publishing`. **Chưa có bảng nào trong mã** (`internal/db/` trống, chưa có migration). Thiết kế: `publish_attempts`, `publish_steps`, `error_mappings`.

## Giao diện công khai

`index.ts` chỉ export `PublishingModule` và kiểu rỗng `PublishingPublicApi` (giữ chỗ, chưa có thao tác).

## Phụ thuộc cho phép

`content`, `media`, `platform_gateway`, `notifications`, `queue`.

## Chạy ở

api + worker (hàng chờ `publish`).

## Tính năng liên quan

[001](../features/001-monorepo-module-skeleton.md) (chỉ dựng khung module).

## Nguồn

- apps/server/src/modules/modules.manifest.json
- apps/server/src/modules/publishing/public-api.ts
- .specify/memory/architecture.md (mục 4)
