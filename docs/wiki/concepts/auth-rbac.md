---
type: concept
title: Xác thực và phân quyền (RBAC)
sources:
  [
    .specify/memory/constitution.md,
    apps/server/docs/auth.md,
    apps/server/docs/database.md,
    apps/server/src/modules/account/public-api.ts,
  ]
updated: 2026-11-14
status: current
related: [modules/account.md, concepts/tenant-rls.md, decisions/index.md]
---

# Xác thực và phân quyền (hiến pháp VI, VII)

**Đã hiện thực (004, mở rộng 009)**.

- `AccessGuard` chạy với mọi route API, **mặc định từ chối**: mỗi handler đúng một khai báo `@Public()`,
  `@CustomerAccess(...quyền)` (cookie `__Host-sid`, cần email đã xác nhận) hoặc `@StaffAccess(...quyền)` (cookie
  `__Host-staff_sid`, giới hạn `STAFF_ALLOWED_CIDRS`). Thiếu khai báo -> 403 `ACCESS_NOT_DECLARED`; dev/test không khởi động.
- Mã lỗi: 401 `UNAUTHENTICATED`, 403 `EMAIL_NOT_VERIFIED`, 403 `FORBIDDEN` (kèm lời giải thích), 503 khi không tra được phiên.
- Trong nghiệp vụ: `currentActor()`, `requireCustomer()`, `requireStaff()`, `can(permission)`.
- Chủ + tối đa 2 cộng tác viên; quyền kiểm ở API, không chỉ ẩn trên giao diện. Truy vấn xác thực dùng `authTx`,
  `runInAccountScope` và hàm `SECURITY DEFINER` (database.md, mục "Xác thực").
- Dùng thư viện đã kiểm chứng, không tự viết mật mã; email Google/Facebook trùng phải xác nhận trước khi liên kết (FR-15).
- Kiểm thử `apps/server/test/auth/access-declarations.spec.ts` chạy trong CI.

Thêm quyền mới: xem auth.md mục "Thêm quyền mới".

## Nguồn

- apps/server/docs/auth.md
- .specify/memory/constitution.md (nguyên tắc VI, VII)
