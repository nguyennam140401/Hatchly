---
type: module
title: Module content (Nội dung)
sources:
  [
    apps/server/src/modules/modules.manifest.json,
    apps/server/src/modules/content/public-api.ts,
    apps/server/src/modules/content/index.ts,
    .specify/memory/architecture.md,
  ]
updated: 2026-11-14
status: draft
related: [modules/context.md, modules/ai_gateway.md, modules/media.md, modules/trends.md]
---

# content – Nội dung

## Trách nhiệm

Kế hoạch nội dung, bài và phiên bản theo kênh, bản nháp AI, trạng thái duyệt, số lần tạo lại ≤ 5, cột phiên bản chống ghi đè (FR-04–06).

## Schema/bảng

Schema `content`. **Chưa có bảng nào trong mã** (`internal/db/` trống, chưa có migration). Thiết kế: `content_plans`, `topics`, `posts`, `channel_variants`, `generations`.

## Giao diện công khai

`index.ts` chỉ export `ContentModule` và kiểu rỗng `ContentPublicApi` (giữ chỗ, chưa có thao tác).

## Phụ thuộc cho phép

`account`, `context`, `media`, `trends`, `ai_gateway`, `notifications`, `queue`.

## Chạy ở

api + worker.

## Tính năng liên quan

[001](../features/001-monorepo-module-skeleton.md) (chỉ dựng khung module).

## Nguồn

- apps/server/src/modules/modules.manifest.json
- apps/server/src/modules/content/public-api.ts
- .specify/memory/architecture.md (mục 4)
