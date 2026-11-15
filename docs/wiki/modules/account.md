---
type: module
title: Module account (Tài khoản & Gói)
sources:
  [
    apps/server/src/modules/modules.manifest.json,
    apps/server/src/modules/account/public-api.ts,
    apps/server/src/modules/account/index.ts,
    apps/server/src/modules/account/internal/db/schema.ts,
    .specify/memory/architecture.md,
    apps/server/docs/auth.md,
  ]
updated: 2026-11-14
status: current
related: [concepts/auth-rbac.md, concepts/tenant-rls.md, modules/notifications.md, modules/queue.md]
---

# account – Tài khoản & Gói

## Trách nhiệm

Đăng ký/đăng nhập (email, Google, Facebook), chủ tài khoản + tối đa 2 cộng tác viên, phiên, nhân viên nội bộ.
Thiết kế còn có gói, chu kỳ, hạn mức 100 bài/5 GB (chưa có mã) – xem architecture.md mục 4.

## Schema/bảng

Schema `account`. Mã hiện có (`internal/db/schema.ts`): `users`, `login_identities`, `memberships`, `sessions`,
`auth_tokens` (tenant); `staff_users`, `staff_sessions`, `auth_throttle` (dùng chung); bảng `accounts` do migration
`0001_accounts.sql`. Chưa có: `subscriptions`, `usage_cycles` (đã thiết kế).

## Giao diện công khai

Export thật (`index.ts`): `AccountModule`, `ACCOUNT_PUBLIC_API`, `AccountPublicApi`, `ActiveMember`, `createStaffOps`,
`StaffInputError`, `StaffOps`, `StaffSummaryRow`. `AccountPublicApi`: `listActiveMembers`, `addMember`, `removeMember`,
`disableMember`, `createVerifiedOwner` (4 hàm sau chỉ cho kiểm thử/dữ liệu mẫu), tra tên hiển thị người dùng (006).
Không nhận `accountId` từ tham số.

## Phụ thuộc cho phép

`queue` (tạo việc thông báo bằng `enqueueRegistered` theo tên, không phụ thuộc `notifications`).

## Chạy ở

api + worker.

## Tính năng liên quan

[004](../features/004-minimal-auth-rbac.md) (xác thực/RBAC), [009](../features/009-social-login-members.md) (đăng nhập
mạng xã hội, thành viên), [001](../features/001-monorepo-module-skeleton.md) (khung), [006](../features/006-sample-module-business-profile.md)
(tra tên người dùng).

## Nguồn

- apps/server/src/modules/modules.manifest.json
- apps/server/src/modules/account/public-api.ts
- apps/server/docs/auth.md
