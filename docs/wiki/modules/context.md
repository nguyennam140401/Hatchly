---
type: module
title: Module context (Ngữ cảnh kinh doanh)
sources:
  [
    apps/server/src/modules/modules.manifest.json,
    apps/server/src/modules/context/public-api.ts,
    apps/server/src/modules/context/index.ts,
    apps/server/src/modules/context/jobs.ts,
    apps/server/src/modules/context/internal/db/schema.ts,
    docs/sample-module.md,
  ]
updated: 2026-11-14
status: current
related: [modules/ai_gateway.md, modules/queue.md, concepts/tenant-rls.md, concepts/queues.md]
---

# context – Ngữ cảnh kinh doanh

## Trách nhiệm

Hồ sơ kinh doanh có phiên bản (giới thiệu, sản phẩm, chính sách, giọng văn, từ khóa) làm đầu vào tạo nội dung AI.
Là module mẫu đầy đủ đầu tiên (006).

## Schema/bảng

Schema `context`: `business_profiles`, `profile_versions` (bất biến – migration `0013`). Thiết kế còn `context_files` (chưa có).

## Giao diện công khai

`ContextModule`, `CONTEXT_PUBLIC_API`, `ContextPublicApi.getCurrentProfile()` (null nếu chưa có hồ sơ; luôn đọc
CSDL, không cache; không trả `accountId`/liên hệ chủ), kiểu `CurrentBusinessProfile`. Loại việc `context.profile_changed`
(hàng chờ `ai_batch`, tạo cùng giao dịch lưu) ở `jobs.ts`, chưa xuất qua `index.ts`.

## Phụ thuộc cho phép

`account`, `ai_gateway`, `queue`.

## Chạy ở

api + worker.

## Tính năng liên quan

[006](../features/006-sample-module-business-profile.md).

## Nguồn

- apps/server/src/modules/context/public-api.ts
- apps/server/src/modules/context/jobs.ts
- docs/sample-module.md
