---
type: module
title: Module approval (Duyệt & lịch)
sources:
  [
    apps/server/src/modules/modules.manifest.json,
    apps/server/src/modules/approval/public-api.ts,
    apps/server/src/modules/approval/index.ts,
    .specify/memory/architecture.md,
  ]
updated: 2026-11-16
status: draft
related: [modules/content.md, modules/publishing.md]
---

# approval – Duyệt & lịch

> **Cập nhật 012:** Từ 012: điều phối duyệt/trả lại/hủy lịch/đổi giờ/sửa bài đã duyệt trong MỘT giao dịch; có controller `/posts/*`, `/approvals/*`, `/calendar`; vẫn không có bảng. Xem [012](../features/012-manual-compose-approval-calendar.md). Các mục dưới đây là mô tả cũ của 001 và cần rà lại.

## Trách nhiệm

Thao tác duyệt bài và xếp lịch của chủ tài khoản (FR-06). Schema dành sẵn, để trống: trạng thái duyệt nằm trên `content.posts`, giờ đăng nằm trên `publishing.publish_attempts`; thêm bảng cần đặc tả mới.

## Schema/bảng

Schema `approval`. **Chưa có bảng nào trong mã** (`internal/db/` trống, chưa có migration). Thiết kế: không có bảng (cố ý dành sẵn).

## Giao diện công khai

`index.ts` chỉ export `ApprovalModule` và kiểu rỗng `ApprovalPublicApi` (giữ chỗ, chưa có thao tác).

## Phụ thuộc cho phép

`account`, `content`, `publishing`, `notifications`, `queue`.

## Chạy ở

chỉ api (`runsIn: [api]`).

## Tính năng liên quan

[001](../features/001-monorepo-module-skeleton.md) (chỉ dựng khung module).

## Nguồn

- apps/server/src/modules/modules.manifest.json
- apps/server/src/modules/approval/public-api.ts
- .specify/memory/architecture.md (mục 4)
