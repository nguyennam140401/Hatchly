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
updated: 2026-11-14
status: draft
related: [concepts/publish-idempotency.md, modules/platform_gateway.md, concepts/queues.md]
---

# publishing – Đăng bài

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
