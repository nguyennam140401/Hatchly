---
type: module
title: Module media (Thư viện media)
sources:
  [
    apps/server/src/modules/modules.manifest.json,
    apps/server/src/modules/media/public-api.ts,
    apps/server/src/modules/media/index.ts,
    .specify/memory/architecture.md,
  ]
updated: 2026-11-14
status: draft
related: [modules/ai_gateway.md, concepts/queues.md]
---

# media – Thư viện media

## Trách nhiệm

Tải ảnh/video thẳng lên kho tệp bằng đường dẫn ký sẵn (`tenants/{mã}/`), dấu tệp chống xử lý trùng, gán nhãn tự động qua Cổng AI và gán nhãn tay, dung lượng (FR-03).

## Schema/bảng

Schema `media`. **Chưa có bảng nào trong mã** (`internal/db/` trống, chưa có migration). Thiết kế: `media`, `media_labels`.

## Giao diện công khai

`index.ts` chỉ export `MediaModule` và kiểu rỗng `MediaPublicApi` (giữ chỗ, chưa có thao tác).

## Phụ thuộc cho phép

`account`, `ai_gateway`, `queue`.

## Chạy ở

api + worker (hàng chờ `media`).

## Tính năng liên quan

[001](../features/001-monorepo-module-skeleton.md) (chỉ dựng khung module).

## Nguồn

- apps/server/src/modules/modules.manifest.json
- apps/server/src/modules/media/public-api.ts
- .specify/memory/architecture.md (mục 4)
