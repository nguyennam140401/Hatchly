# Hợp đồng: HTTP API xác thực

Tiền tố `/api/v1`. Thân yêu cầu và phản hồi là JSON. Lỗi theo `ErrorResponse` của 001
(`specs/001-monorepo-module-skeleton/contracts/http-api.md`). Lược đồ đầu vào ở `@app/shared/auth`
(Zod), dùng chung cho web. Mọi yêu cầu thay đổi dữ liệu phải qua kiểm tra nguồn gửi (R3); không qua
thì 403 `CSRF_REJECTED`.

Cột **Truy cập**: `Public` · `Customer(+unverified)` = khách hàng đã đăng nhập, cho phép cả khi chưa xác
minh email · `Customer` = phải đã xác minh · `Staff`.

## 1. Khách hàng

| Phương thức, đường dẫn | Truy cập | Thân yêu cầu | Thành công | Lỗi có chủ đích |
|---|---|---|---|---|
| `POST /auth/register` | Public | `{ displayName, email, password, acceptTerms: true, termsVersion }` | 202 `{ status: 'check_email' }`; **không bao giờ** đặt cookie (giống hệt nhau cho email mới và email đã có) | 400 `VALIDATION_FAILED` (gồm `PASSWORD_WEAK` ở `fieldErrors`), 429 `RATE_LIMITED` |
| `POST /auth/login` | Public | `{ email, password }` | 200 `MeResponse` + cookie | 401 `INVALID_CREDENTIALS`, 429 `LOGIN_THROTTLED` (`retryAfterSeconds`), 403 `ACCOUNT_UNAVAILABLE` (tài khoản đang xóa / người dùng bị khóa – chỉ trả **sau khi** mật khẩu đúng) |
| `POST /auth/logout` | Customer(+unverified) | — | 204, xóa cookie | 401 |
| `POST /auth/logout-all` | Customer(+unverified) | — | 204, xóa cookie, thu hồi mọi phiên của người dùng | 401 |
| `GET /auth/me` | Customer(+unverified) | — | 200 `MeResponse` | 401 |
| `POST /auth/email/verify` | Public | `{ token }` | 200 `MeResponse` + cookie mới | 400 `TOKEN_INVALID` (hành động `resend`) |
| `POST /auth/email/resend` | Public | `{ email? }`: đã đăng nhập (chưa xác minh) thì dùng email của phiên, nếu không thì dùng `email` trong thân | 202 `{ status: 'check_email' }`, **luôn** như nhau (email không tồn tại, đã xác minh, hay đã chạm 3 thư/giờ đều thế) | 400, 429 `RATE_LIMITED` theo địa chỉ mạng |
| `PATCH /auth/email` | Customer(+unverified) | `{ email }` | 202 `{ status: 'check_email' }` | 409 `EMAIL_ALREADY_VERIFIED`, 400 |
| `POST /auth/password/forgot` | Public | `{ email }` | 202 `{ status: 'check_email' }`, **luôn** như nhau | 400 (sai cú pháp email), 429 `RATE_LIMITED` theo địa chỉ mạng |
| `POST /auth/password/reset` | Public | `{ token, newPassword }` | 200 `MeResponse` + cookie mới; mọi phiên cũ bị thu hồi | 400 `TOKEN_INVALID`, 400 `VALIDATION_FAILED` |
| `POST /auth/password/change` | Customer | `{ currentPassword, newPassword }` | 204; các phiên khác bị thu hồi, phiên hiện tại được cấp mã mới | 401 `INVALID_CREDENTIALS` (`fieldErrors` trên `currentPassword`, có đếm chống dò), 429 `LOGIN_THROTTLED` |

`MeResponse`:

```json
{
  "user": { "id": "…", "displayName": "Lan", "email": "lan@example.vn", "emailVerified": true },
  "account": { "id": "…", "status": "active" },
  "role": "owner",
  "permissions": ["context.manage", "post.edit", "…"]
}
```

Không bao giờ trả `passwordHash`, mã phiên hay `token_hash`. `permissions` lấy từ danh mục quyền để web
ẩn/hiện nút. Đây chỉ là trải nghiệm, API vẫn tự chặn.

**Chống dò email (FR-006, FR-008b)**:
- `register`: phản hồi giống hệt nhau cho cả hai trường hợp (mã, thân, tiêu đề, không cookie, thời
  gian tương đương vì băm mật khẩu luôn chạy). Email mới thì gửi thư xác minh; email đã có thì gửi thư
  "email đã có tài khoản" kèm nút "Đăng nhập" / "Quên mật khẩu". Web hiện cùng màn hình "Hãy kiểm tra
  email", có nút "Gửi lại thư" (gọi `resend` với email vừa nhập).
- Người dùng **được đăng nhập khi mở liên kết xác minh** (`email/verify` cấp phiên). Họ cũng có thể đăng
  nhập bằng mật khẩu trước khi xác minh, khi đó chỉ dùng được các điểm cuối `+unverified`.
- `login`: email không tồn tại, sai mật khẩu, hay người dùng không có cách đăng nhập `password` đều trả
  401 `INVALID_CREDENTIALS` với cùng thông điệp "Email hoặc mật khẩu chưa đúng." và thời gian tương
  đương (băm giả, R2).

## 2. Nhân viên nội bộ

| Phương thức, đường dẫn | Truy cập | Thân yêu cầu | Thành công | Lỗi |
|---|---|---|---|---|
| `POST /internal/auth/login` | Public (lối vào nội bộ, kiểm tra `STAFF_ALLOWED_CIDRS`) | `{ email, password }` | 200 `StaffMeResponse` + cookie `__Host-staff_sid` | 401 `INVALID_CREDENTIALS`, 429 `LOGIN_THROTTLED`, 403 `IP_NOT_ALLOWED` |
| `POST /internal/auth/logout` | Staff | — | 204 | 401 |
| `GET /internal/auth/me` | Staff | — | 200 `StaffMeResponse` | 401 |

`StaffMeResponse`: `{ staff: { id, displayName, email }, role: 'support' | 'admin', permissions: [...] }`.

## 3. Mã lỗi mới (`ERROR_CODES` trong `@app/shared/core`)

| Mã | HTTP | Thông điệp (tiếng Việt đời thường) | `actions` |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | "Bạn cần đăng nhập để tiếp tục." | `navigate` → `/login` |
| `FORBIDDEN` | 403 | Theo quyền thiếu, vd "Chỉ chủ tài khoản mới duyệt được bài." | `navigate` (quay lại) + `contact_owner` khi là cộng tác viên |
| `EMAIL_NOT_VERIFIED` | 403 | "Hãy xác nhận email để tiếp tục." | `resend_verification` |
| `ACCESS_NOT_DECLARED` | 403 | "Chức năng này tạm thời không dùng được." | `contact_support` (lỗi lập trình) |
| `CSRF_REJECTED` | 403 | "Yêu cầu không hợp lệ. Hãy tải lại trang và thử lại." | `retry` |
| `INVALID_CREDENTIALS` | 401 | "Email hoặc mật khẩu chưa đúng." | `fix_input`, `navigate` → `/forgot-password` |
| `LOGIN_THROTTLED` | 429 | "Bạn đã thử sai nhiều lần. Hãy thử lại sau {n} phút hoặc đặt lại mật khẩu." | `navigate` → `/forgot-password`; tiêu đề `Retry-After` |
| `RATE_LIMITED` | 429 | "Bạn thao tác quá nhanh. Hãy thử lại sau ít phút." | `retry` |
| `ACCOUNT_UNAVAILABLE` | 403 | "Tài khoản này đang tạm khóa hoặc đang được xóa." | `contact_support` |
| `TOKEN_INVALID` | 400 | "Liên kết đã hết hạn hoặc đã được dùng." | `resend_verification` hoặc `navigate` → `/forgot-password` |
| `EMAIL_ALREADY_VERIFIED` | 409 | "Email của bạn đã được xác nhận." | `navigate` → `/` |
| `IP_NOT_ALLOWED` | 403 | "Lối vào nội bộ không mở cho mạng này." | `contact_support` |
| `OWNER_REQUIRED` | 409 | "Tài khoản phải luôn có một chủ tài khoản." | `fix_input` |
| `SEATS_FULL` | 409 | "Tài khoản đã đủ 2 cộng tác viên." | `navigate` → quản lý thành viên |

Thêm `ErrorAction.kind` mới: `resend_verification`, `contact_owner`. Mã lỗi gốc (`bad_password`,
`blocked`…) chỉ nằm ở `support.detail`. Riêng với `INVALID_CREDENTIALS`, `detail` luôn là
`invalid_credentials` để không lộ lý do.

## 4. Cookie

| Tên | Thuộc tính | Hết hạn |
|---|---|---|
| `__Host-sid` | `HttpOnly; Secure; SameSite=Lax; Path=/` | `Max-Age` = hết hạn tuyệt đối của phiên |
| `__Host-staff_sid` | như trên | cookie phiên trình duyệt |

Đăng xuất hoặc phiên không hợp lệ thì đặt `Max-Age=0`.
