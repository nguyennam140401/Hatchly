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
updated: 2026-11-16
status: draft
related: [modules/context.md, modules/ai_gateway.md, modules/media.md, modules/trends.md]
---

# content – Nội dung

> **Cập nhật 012:** Từ 012: bảng `posts`, `channel_variants`, `post_events`, `channel_rules`; hàm công khai nhận `tx` (`ContentPublicApi`: tạo/lưu nháp, chuyển trạng thái có điều kiện, kiểm tra theo kênh, Lịch). Chưa có: `content_plans`, `topics`, `generations`. Phụ thuộc thêm `platform_gateway`. Xem [012](../features/012-manual-compose-approval-calendar.md). Các mục dưới đây là mô tả cũ của 001 và cần rà lại.

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
