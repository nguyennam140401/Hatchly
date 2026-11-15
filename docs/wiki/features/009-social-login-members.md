---
type: feature
title: 009 Đăng nhập Google/Facebook và thành viên
sources:
  [
    specs/009-social-login-members/spec.md,
    specs/009-social-login-members/checklists/requirements.md,
  ]
updated: 2026-11-14
status: draft
related:
  [
    modules/account.md,
    modules/notifications.md,
    concepts/auth-rbac.md,
    concepts/tenant-rls.md,
    concepts/module-boundaries.md,
  ]
---

# 009 Đăng nhập Google/Facebook và thành viên

## Mục tiêu

Hoàn thiện FR-15 cho người dùng khách hàng, trên nền 004 (email + mật khẩu): (1) đăng nhập Google/Facebook;
(2) một người dùng gắn nhiều cách đăng nhập và tự quản lý; (3) trùng email thì xác nhận, không tự gộp;
(4) chủ tài khoản mời/gỡ cộng tác viên. Nhân viên nội bộ không thuộc phạm vi.

## Mã FR/NFR

- FR-15 (đặc tả yêu cầu); quyền `members.manage`, 1 chủ + tối đa 2 cộng tác viên; UI/UX màn hình Thành viên.
- Spec: FR-001…FR-033, SC-001…SC-010 (`specs/009-social-login-members/spec.md`).
- Hiến pháp: I, VI, VII (không gộp tự động, ô đồng ý không đặt sẵn), VIII, IX; WBS T1, T7; ADR-02, ADR-08.

## Trạng thái

`draft`: mới có spec.md và checklist (WBS T1); chưa có plan/tasks/data-model, chưa có mã. Mục Assumptions còn
điểm cần `/speckit-clarify` (vd người bị gỡ được tự tạo tài khoản riêng).

## Quyết định chính

- Nhận diện người dùng theo cặp (nhà cung cấp, mã phía nhà cung cấp); chỉ lưu mã, email, tên hiển thị (FR-002, FR-006).
- Lần đầu: chỉ tạo tài khoản + user + vai trò chủ + cách đăng nhập sau khi người dùng tích đồng ý điều khoản (FR-003).
- Facebook không trả email → bắt nhập và xác minh; email không chắc đã xác minh thì coi như chưa (FR-004).
- Trùng email: không tự gộp; xác nhận bằng mật khẩu (nếu có và đã xác minh) hoặc link email (FR-010, FR-011).
- Lượt đăng nhập qua nhà cung cấp gắn với trình duyệt khởi tạo, dùng một lần, hạn 10 phút (FR-007).
- Lời mời: dùng một lần, hạn 7 ngày; lời mời đang chờ tính vào giới hạn 2 (FR-020, FR-021). Gỡ thành viên
  không xóa nội dung đã tạo (FR-026); hiệu lực chậm ≤ 60 giây do cache phiên + vai trò (ADR-08).
- Đăng nhập Facebook tách hẳn khỏi kết nối Page (FR-005, FR-02).

## Chạm tới

- Module `account` (bảng đã có từ 004: `account.login_identities`, `account.memberships`, `account.users`).
- Thực thể mới dự kiến: `invitations` (`loi_moi`), lượt đăng nhập qua nhà cung cấp, yêu cầu xác nhận liên kết;
  tên chốt ở plan/data-model; đều cần `account_id` + RLS (FR-031).
- Gửi email qua giao diện thư tối thiểu của 004 (liên quan module `notifications`).
- Google, Meta (đăng nhập) phải vào danh sách chuyển dữ liệu xuyên biên giới (FR-032).

## Điểm cần biết khi sửa tiếp

- Một người dùng một tài khoản (004 FR-004) giữ nguyên; email đang là chủ/cộng tác viên nơi khác không nhận mời được.
- Người dùng có thể không có mật khẩu và không thuộc tài khoản nào (FR-027); không gỡ cách đăng nhập cuối (FR-016).
- Test dùng nhà cung cấp giả lập, không gọi ra ngoài; phụ thuộc P5 (đăng ký app Google/Meta).
- Ngoài phạm vi: chuyển quyền chủ, tự rời tài khoản, nhiều tài khoản/người dùng, xóa tài khoản (FR-14).

## Nguồn

`specs/009-social-login-members/spec.md`, `specs/009-social-login-members/checklists/requirements.md`.
