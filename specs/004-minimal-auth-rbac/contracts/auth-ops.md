# Hợp đồng: cấu hình, lệnh vận hành, môi trường dev

## 1. Biến môi trường mới (`core/config/config.schema.ts`)

| Biến | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|
| `WEB_BASE_URL` | có | — | URL gốc của SPA để dựng liên kết trong thư, vd `https://app.example.vn` |
| `WEB_ORIGINS` | không | gốc của `WEB_BASE_URL` | Danh sách nguồn được gửi yêu cầu thay đổi dữ liệu (CSRF, R3) |
| `TRUST_PROXY_HOPS` | không | `0` dev, `1` staging/production | Số proxy tin cậy để lấy địa chỉ mạng thật |
| `AUTH_THROTTLE_SECRET` | có | — | `secret()`, ≥ 32 byte; khóa HMAC cho `auth_throttle` |
| `SESSION_IDLE_DAYS` / `SESSION_ABSOLUTE_DAYS` | không | `14` / `30` | khách hàng |
| `STAFF_SESSION_IDLE_MINUTES` / `STAFF_SESSION_ABSOLUTE_HOURS` | không | `30` / `12` | nhân viên |
| `STAFF_ALLOWED_CIDRS` | không | rỗng (không giới hạn) | vd `10.0.0.0/8,203.0.113.4/32` |
| `LOGIN_MAX_FAILURES_PER_EMAIL` / `..._PER_IP` / `LOGIN_WINDOW_MINUTES` / `LOGIN_BLOCK_MINUTES` | không | `5` / `30` / `15` / `15` | R6 |
| `ARGON2_MEMORY_KIB` / `ARGON2_TIME_COST` | không | `19456` / `2` | R2; kiểm thử dùng giá trị nhỏ để chạy nhanh |
| `TERMS_VERSION` | có | — | phiên bản điều khoản hiện hành, vd `2026-11` |
| `MAIL_TRANSPORT` | có | — | `smtp` \| `memory` (`memory` bị từ chối khi `APP_ENV=production`) |
| `SMTP_URL` | khi `smtp` | — | `secret()`, vd `smtp://localhost:1025` (Mailpit) hoặc `smtps://…` (SES) |
| `MAIL_FROM` | khi `smtp` | — | vd `"Tên ứng dụng" <no-reply@example.vn>` |

Thiếu biến hoặc sai định dạng thì API không khởi động, và thông báo chỉ nêu tên biến (như 001/002).
`.env.example` có giá trị cho dev (`AUTH_THROTTLE_SECRET=dev_only_…`, `MAIL_TRANSPORT=smtp`,
`SMTP_URL=smtp://localhost:1025`).

## 2. Lệnh vận hành nhân viên (`pnpm staff …`, `apps/server/src/ops/staff.ts`)

| Lệnh | Tác dụng | Kiểm toán |
|---|---|---|
| `staff create --email <e> --name <tên> --role support\|admin` | Đọc mật khẩu từ stdin (ẩn ký tự khi chạy ở terminal) rồi áp chính sách FR-005 | `staff.created` |
| `staff disable --email <e>` | `status = disabled`, thu hồi mọi phiên | `staff.disabled` |
| `staff reset-password --email <e>` | Mật khẩu mới qua stdin, thu hồi mọi phiên | `staff.password_reset` |
| `staff list` | In email, tên, vai trò, trạng thái (không in băm) | — |

Lệnh dùng `DATABASE_APP_URL` (không cần `owner`). Mã thoát: `0` thành công · `1` lỗi đầu vào hoặc
không tìm thấy · `2` thiếu cấu hình hoặc không kết nối được.

## 3. Lệnh dev cho dữ liệu mẫu (`pnpm dev:seed-auth`, chỉ khi `APP_ENV ∈ {development, test}`)

Tạo 1 tài khoản mẫu gồm chủ `owner@example.test` (đã xác minh) và 2 cộng tác viên, cộng 1 nhân viên
`support` và 1 nhân viên `admin`. Mật khẩu mẫu in ra đúng một lần lúc chạy. Lệnh dùng các thao tác thành
viên nội bộ (thêm, gỡ, khóa) của dịch vụ `account`, nên kiểm thử dùng lại được.

## 4. Docker compose (dev)

- Thêm dịch vụ `mailpit` (ảnh `axllent/mailpit`, khóa thẻ phiên bản). Cổng SMTP 1025, giao diện xem thư
  ở http://localhost:8025. **Chỉ dùng cho dev**, không có trong hạ tầng thật.
- `api` nhận thêm các biến ở mục 1.
- Cổng mới 1025/8025 cũng chịu lưu ý chung: không chạy compose ở hai checkout cùng lúc.

## 5. Kiểm tra trong CI (bổ sung cho `tooling/verify.mjs`)

- Quy tắc ranh giới mới: `auth-tx-restricted`, `account-scope-restricted`. Quy tắc
  `bind-account-restricted` thu hẹp lại: chỉ `core/auth/access.guard.ts` được gọi
  `bindAccountToRequest`, thay cho cả thư mục `core/auth/`.
- Kiểm thử `access-declarations.spec.ts` chạy trong `pnpm test`.
- `pnpm db:check` sau migration 0005–0007: 0 vi phạm.
- Quét bí mật: thêm mẫu `__Host-sid=`, `__Host-staff_sid=`, `$argon2id$`.
