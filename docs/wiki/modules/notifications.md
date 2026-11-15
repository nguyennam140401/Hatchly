---
type: module
title: Module notifications (Thông báo)
sources:
  [
    apps/server/src/modules/modules.manifest.json,
    apps/server/src/modules/notifications/public-api.ts,
    apps/server/src/modules/notifications/index.ts,
    apps/server/src/modules/notifications/jobs.ts,
    apps/server/src/modules/notifications/notifications.module.ts,
    apps/server/docs/gateways.md,
  ]
updated: 2026-11-14
status: draft
related: [modules/queue.md, modules/account.md, concepts/queues.md]
---

# notifications – Thông báo

## Trách nhiệm

Thông báo trong ứng dụng + email, chống gửi lặp, gộp tin 10 phút (FR-09). Tự quyết kênh/người nhận theo danh mục.

## Schema/bảng

Schema `notifications`; thiết kế: `notifications`. **Chưa có bảng trong mã** (`internal/db/` trống): kho hiện là bản
giả (`internal/fake`); bản thật là WBS 4.3.

## Giao diện công khai

`NotificationsModule`, `NOTIFICATION_STORE`, `NOTIFICATIONS`, `NotificationsPublicApi.emit(tx, event)` (phát trong giao
dịch nghiệp vụ; trả `queued` | `duplicate_pending`), `NotificationEvent`, `NotificationType`,
`NotificationEventInvalidError` (trường cấm: số tiền, mã quyền, nội dung bài…), `fakeNotify`. Việc `notifications.deliver`
(hàng chờ `notify`, tenant) ở `jobs.ts`.

## Phụ thuộc cho phép

`account` (tra người nhận), `queue`.

## Chạy ở

api + worker. `NOTIFICATIONS_DRIVER` hiện chỉ `fake`.

## Tính năng liên quan

[005](../features/005-gateway-contracts-fakes.md), [003](../features/003-queue-layer-pgboss.md) (hàng chờ `notify`),
[008](../features/008-cicd-jenkins-pipeline.md) (kiểm tra khói dùng hàng chờ `notify`).

## Nguồn

- apps/server/src/modules/notifications/public-api.ts
- apps/server/docs/gateways.md (mục 3)
