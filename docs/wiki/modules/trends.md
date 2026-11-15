---
type: module
title: Module trends (Xu hướng)
sources:
  [
    apps/server/src/modules/modules.manifest.json,
    apps/server/src/modules/trends/public-api.ts,
    apps/server/src/modules/trends/index.ts,
    .specify/memory/architecture.md,
  ]
updated: 2026-11-14
status: draft
related: [modules/ai_gateway.md, concepts/queues.md]
---

# trends – Xu hướng

## Trách nhiệm

Tổng hợp xu hướng theo ngành hằng tuần từ RSS báo chính thống + Brave Search API, tóm tắt qua Cổng AI; không cào mạng xã hội (FR-04).

## Schema/bảng

Schema `trends`. **Chưa có bảng nào trong mã** (`internal/db/` trống, chưa có migration). Thiết kế: `industries`, `industry_trends`, `account_keywords`.

## Giao diện công khai

`index.ts` chỉ export `TrendsModule` và kiểu rỗng `TrendsPublicApi` (giữ chỗ, chưa có thao tác).

## Phụ thuộc cho phép

`ai_gateway`, `queue`.

## Chạy ở

api + worker (hàng chờ `trends`).

## Tính năng liên quan

[001](../features/001-monorepo-module-skeleton.md) (chỉ dựng khung module).

## Nguồn

- apps/server/src/modules/modules.manifest.json
- apps/server/src/modules/trends/public-api.ts
- .specify/memory/architecture.md (mục 4)
