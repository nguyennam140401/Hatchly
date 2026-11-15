---
type: feature
title: 004 – Xác thực tối thiểu và phân quyền RBAC
sources:
  [
    specs/004-minimal-auth-rbac/spec.md,
    specs/004-minimal-auth-rbac/plan.md,
    specs/004-minimal-auth-rbac/tasks.md,
    specs/004-minimal-auth-rbac/data-model.md,
    specs/004-minimal-auth-rbac/research.md,
    specs/004-minimal-auth-rbac/quickstart.md,
    specs/004-minimal-auth-rbac/contracts/auth-http-api.md,
    specs/004-minimal-auth-rbac/contracts/authz-api.md,
    specs/004-minimal-auth-rbac/contracts/auth-ops.md,
  ]
updated: 2026-11-14
status: current
related:
  [
    modules/account.md,
    concepts/auth-rbac.md,
    concepts/tenant-rls.md,
    concepts/module-boundaries.md,
    concepts/migrations.md,
  ]
---

# 004 – Xác thực tối thiểu và phân quyền RBAC

## Mục tiêu

Cửa vào của mọi tính năng khách hàng: đăng ký/đăng nhập/đăng xuất bằng email + mật khẩu, xác minh email,
quên/đổi mật khẩu, phiên đăng nhập an toàn, 4 vai trò (chủ, cộng tác viên, hỗ trợ, quản trị) và **một lớp
chặn quyền dùng chung ở API, mặc định từ chối**. Đây là con đường duy nhất đưa mã tài khoản (`account_id`)
vào yêu cầu để lớp RLS của 002 áp cô lập (`specs/004-minimal-auth-rbac/spec.md`).

## Mã FR/NFR

WBS 2.1; FR-15 (phần email + mật khẩu); bảng phân quyền mục 3; ADR-02; hiến pháp nguyên tắc I, VI, VII, VIII, IX.
Yêu cầu nội bộ của spec: FR-001…FR-022 (gồm FR-008a/b xác minh/đặt lại, FR-012a phiên, FR-016 nhân viên nội bộ,
FR-020 truy cập CSDL trước khi có tenant).

## Trạng thái

Đã merge vào `dev`. `tasks.md`: 87/88 xong; còn T087 (chạy kịch bản thủ công `quickstart.md` mục 0, 2, 3 và ghi
"Kết quả kiểm chứng") (`specs/004-minimal-auth-rbac/tasks.md`).

## Quyết định chính

- Bộ thư viện nhỏ thay cho khung trọn gói: argon2id (`@node-rs/argon2`), mã phiên ngẫu nhiên lưu SHA-256,
  `nodemailer`; khung trọn gói bị loại vì tự truy vấn ngoài ngữ cảnh tenant (R1, R4).
- Phiên phía máy chủ, cookie `__Host-sid`; cache trong tiến trình 60 giây nên thu hồi có hiệu lực ≤ 60 giây (R3).
- Giữ RLS cho bảng danh tính; truy cập trước khi biết tenant đi qua 4 hàm `SECURITY DEFINER` hẹp, `authTx`,
  `runInAccountScope`, đều có quy tắc ranh giới tự động (R4).
- `core/auth`: danh mục 13 quyền, decorator `@Public`/`@CustomerAccess`/`@StaffAccess`, `AccessGuard` toàn cục là
  nơi duy nhất gọi `bindAccountToRequest`, kiểm tra nguồn gửi (CSRF), `currentActor()`. Lõi không nhập module:
  gọi `account` qua giao diện `SessionResolver` (`contracts/authz-api.md`).
- Chống liệt kê tài khoản: `register`, `resend`, `forgot` luôn trả 202 như nhau (`contracts/auth-http-api.md`).
- Gửi thư qua `core/mail` (`smtp` | `memory`), dev dùng Mailpit; nhân viên nội bộ dùng mật khẩu, phiên ngắn,
  giới hạn `STAFF_ALLOWED_CIDRS`; xác thực bước hai hoãn đến trước ngày ra mắt (Clarifications, FR-016).

## Chạm tới

- Schema `account`: 5 bảng tenant mới (`users`, `login_identities`, `memberships`, `sessions`, `auth_tokens`),
  3 bảng shared, 4 hàm `SECURITY DEFINER`, mở rộng `CHECK` của `infra.audit_log` (`data-model.md`).
- API: `/auth/*` (register, login, logout, logout-all, me, email/verify|resend, PATCH email,
  password/forgot|reset|change) và `/internal/auth/*` cho nhân viên (`contracts/auth-http-api.md`).
- Code: `apps/server/src/core/auth`, `apps/server/src/core/mail`, module `account`; web: 7 trang auth + "cổng phiên".
- Lệnh vận hành và cấu hình: `contracts/auth-ops.md`.

## Điểm cần biết khi sửa tiếp

- Endpoint mới MUST khai báo decorator quyền; thiếu khai báo thì `AccessGuard` từ chối. Kiểm thử ma trận
  `apps/server/test/auth/access-matrix.e2e.spec.ts` tự phủ quyền mới.
- Không đọc `accountId` từ tham số/thân yêu cầu; có kiểm thử chèn `account-id-injection.e2e.spec.ts`.
- Đổi vai trò/thu hồi phiên chỉ có hiệu lực sau tối đa 60 giây do cache phiên (`session-cache.ts`).
- Đăng nhập Google/Facebook chưa làm; `arctic` chỉ ghi nhận cho tính năng sau (`plan.md`).
- Module `notifications` sẽ thay phần gửi thư sau này (xem [005](005-gateway-contracts-fakes.md)).

## Nguồn

`specs/004-minimal-auth-rbac/spec.md`, `plan.md`, `tasks.md`, `data-model.md`, `research.md`, `quickstart.md`,
`contracts/auth-http-api.md`, `contracts/authz-api.md`, `contracts/auth-ops.md`.
