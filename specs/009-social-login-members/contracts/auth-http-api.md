# Hợp đồng: HTTP API – đăng nhập Google/Facebook, cách đăng nhập, thành viên, lời mời

Tiền tố `/api/v1`. JSON, lỗi theo `ErrorResponse` (001). Lược đồ đầu vào ở `@app/shared/auth` (Zod).
Bổ sung cho [hợp đồng của 004](../../004-minimal-auth-rbac/contracts/auth-http-api.md); các điểm cuối cũ
giữ nguyên trừ mục 7.

Cột **Truy cập**: `Public` · `Customer` (đã xác minh email) · `Customer(+unverified)` · thêm `+detached`
= cho phép cả người đang ở tài khoản chờ (`allowDetached`) · `Customer(members.manage)`.

`{provider}` ∈ `google` | `facebook`. Giá trị khác → 404.

## 1. Đăng nhập qua nhà cung cấp

| Phương thức, đường dẫn | Truy cập | Thân yêu cầu | Thành công | Lỗi có chủ đích |
|---|---|---|---|---|
| `POST /auth/oauth/{provider}/start` | Public | `{ purpose: 'login' }` hoặc `{ purpose: 'invite', invitationToken, acceptTerms: true, termsVersion }` | 200 `{ authorizationUrl }` + cookie `__Host-oauth` | 400 `INVITE_INVALID`, 429 `RATE_LIMITED`, 503 `PROVIDER_UNAVAILABLE`; `invite` khi yêu cầu có phiên hợp lệ: 409 `ALREADY_IN_ACCOUNT`, 409 `INVITE_EMAIL_MISMATCH` |
| `GET /auth/oauth/{provider}/callback` | Public | truy vấn `code`, `state` (hoặc `error`) do nhà cung cấp gửi | **303** về `{WEB}/oauth/result` (không tham số); có thể kèm cookie phiên | không trả lỗi JSON: mọi lỗi ghi vào lượt rồi vẫn 303 |
| `GET /auth/oauth/pending` | Public (cookie `__Host-oauth`) | — | 200 `OAuthPendingResponse` | 400 `OAUTH_FLOW_INVALID` |
| `POST /auth/oauth/signup` | Public (cookie) | `{ displayName, email?, acceptTerms: true, termsVersion }` | giai đoạn `needs_signup`: 200 `MeResponse` + cookie phiên · giai đoạn `needs_email`: 202 `{ status: 'check_email' }` (**luôn** như nhau) | 400 `VALIDATION_FAILED`, 400 `OAUTH_FLOW_INVALID`, 409 `IDENTITY_IN_USE` |
| `POST /auth/oauth/link/password` | Public (cookie) | `{ password }` | 200 `MeResponse` + cookie phiên | 401 `INVALID_CREDENTIALS`, 429 `LOGIN_THROTTLED`, 400 `OAUTH_FLOW_INVALID` (kể cả khi cách này không được phép), 409 `IDENTITY_IN_USE`, 409 `PROVIDER_ACCOUNT_CONFLICT` |
| `POST /auth/oauth/link/send-email` | Public (cookie) | — | 202 `{ status: 'check_email' }` | 400 `OAUTH_FLOW_INVALID`; quá 3 thư/giờ vẫn 202 |
| `POST /auth/oauth/confirm` | Public | `{ token }` (mã trong liên kết thư) | 200 `MeResponse` + cookie phiên | 400 `TOKEN_INVALID`, 409 `PROVIDER_ACCOUNT_CONFLICT` |

`OAuthPendingResponse`:

```json
{
  "provider": "google",
  "purpose": "login",
  "stage": "needs_link_confirm",
  "suggestedDisplayName": "Lan",
  "suggestedEmail": "l***@example.vn",
  "emailRequired": false,
  "methods": ["password", "email"],
  "hint": "login_with_google",
  "error": null
}
```

- `stage` ∈ `signed_in` | `needs_signup` | `needs_email` | `needs_link_confirm` | `awaiting_email` |
  `completed` | `failed`.
- `suggestedEmail` chỉ đầy đủ ở `needs_signup` / `needs_email` (email của chính người dùng); ở
  `needs_link_confirm` được che bớt.
- `methods`: `['password','email']` hoặc `['email']` (FR-011). `hint`: gợi ý cách đã liên kết
  (`login_with_google` | `login_with_facebook` | `null`) cho trường hợp US2 kịch bản 5.
- `error`: `{ code, message, actions }` khi `failed` – vd `OAUTH_CANCELLED`, `OAUTH_FAILED`,
  `INVITE_EMAIL_MISMATCH`, `ACCOUNT_UNAVAILABLE`, `PROVIDER_ACCOUNT_CONFLICT`, và với `purpose: 'invite'`:
  `INVITE_INVALID`, `INVITE_EMAIL_IN_USE`, `IDENTITY_IN_USE`, `SEATS_FULL`.
- Không bao giờ có mã của nhà cung cấp, `state`, mã người dùng phía nhà cung cấp.

Quy tắc:

- Lượt gắn trình duyệt bằng cookie `__Host-oauth`; callback không có cookie, sai `state`, lặp lại hoặc
  quá 10 phút → lượt `failed` (`OAUTH_FLOW_INVALID`), kiểm toán `auth.oauth.failed`.
- `signup` ở `needs_email`: phản hồi, thời gian và cookie giống nhau dù email đã có người dùng hay chưa
  (research R4). Thư gửi đi khác nhau: "hoàn tất đăng ký" hoặc "xác nhận liên kết".
- `confirm` dùng cho cả hai loại thư; không cần cookie `__Host-oauth` (mở trên thiết bị khác được).
- Người dùng bị khóa, hoặc tài khoản `deleting`: lượt `failed` với `ACCOUNT_UNAVAILABLE`, không tạo gì –
  cả khi tìm được theo danh tính lẫn theo email đã xác minh; với email tự nhập thì vẫn 202, không gửi thư.
- Người dùng trùng email **đã có một danh tính cùng nhà cung cấp** (mã khác): không vào
  `needs_link_confirm`. Email nhà cung cấp đã xác minh → lượt `failed` với `PROVIDER_ACCOUNT_CONFLICT`.
  Email tự nhập → `signup` vẫn 202 `check_email` như mọi trường hợp, không phát mã liên kết, người dùng đã
  có nhận thư thông tin `identity_link_blocked` (việc `account.mail_notice`, tính vào ngưỡng
  `mail_link_confirm`).
- Đăng nhập thành công bằng danh tính đã liên kết của người ở tài khoản chờ → vẫn cấp phiên;
  `MeResponse.account.status = 'unclaimed'`.

## 2. Cách đăng nhập của tôi

| Phương thức, đường dẫn | Truy cập | Thân | Thành công | Lỗi |
|---|---|---|---|---|
| `GET /auth/login-methods` | Customer(+unverified, +detached) | — | 200 `{ methods: LoginMethod[], reauthFresh: boolean }` | 401 |
| `POST /auth/reauth` | Customer(+unverified, +detached) | `{ password }` | 204 | 401 `INVALID_CREDENTIALS`, 429 `LOGIN_THROTTLED` |
| `POST /auth/login-methods/{provider}/start` | Customer(+detached) | `{ purpose: 'link' \| 'reauth' }` | 200 `{ authorizationUrl }` + cookie `__Host-oauth` | `link`: 403 `REAUTH_REQUIRED`, 409 `LOGIN_METHOD_EXISTS`; 503 `PROVIDER_UNAVAILABLE` |
| `DELETE /auth/login-methods/{kind}` | Customer(+detached) | — (`kind` ∈ `password` \| `google` \| `facebook`) | 204 | 403 `REAUTH_REQUIRED`, 409 `LAST_LOGIN_METHOD`, 404 |
| `POST /auth/login-methods/password/request` | Customer(+detached) | — | 202 `{ status: 'check_email' }` (thư đặt mật khẩu tới email của người dùng) | 403 `REAUTH_REQUIRED`, 409 `LOGIN_METHOD_EXISTS` |

`LoginMethod`: `{ kind: 'password' | 'google' | 'facebook', linked: boolean, providerEmail?: string,
providerDisplayName?: string, linkedAt?: string }` – luôn đủ ba dòng.

- Kết quả `link` / `reauth` đọc qua `GET /auth/oauth/pending` (`stage: 'completed'` hoặc `failed` với
  `IDENTITY_IN_USE`, `REAUTH_MISMATCH` – danh tính dùng để xác nhận lại không thuộc người dùng này).
- Liên kết từ Cài đặt không so email (FR-014); email đăng nhập chính không đổi.
- `reauthFresh` = `coalesce(reauthenticated_at, created_at)` của phiên trong 10 phút gần nhất. Phiên cấp
  do xoay vòng (`claim`, `accept-existing`) mang mốc của phiên cũ.
- Mỗi lần thêm/gỡ: kiểm toán + việc `account.mail_notice` trong cùng giao dịch (FR-013).

## 3. Thành viên (chỉ chủ)

| Phương thức, đường dẫn | Truy cập | Thân | Thành công | Lỗi |
|---|---|---|---|---|
| `GET /members` | Customer(`members.manage`) | — | 200 `MembersResponse` | 403 `FORBIDDEN` |
| `POST /members/invitations` | Customer(`members.manage`) | `{ email }` | 201 `InvitationView` (email đang có lời mời chờ → 200, coi là "Gửi lại") | 409 `SEATS_FULL`, 400 `INVITE_SELF`, 400 `VALIDATION_FAILED`, 429 `RATE_LIMITED` |
| `POST /members/invitations/{id}/resend` | Customer(`members.manage`) | — | 200 `InvitationView` | 404, 429 `RATE_LIMITED` |
| `DELETE /members/invitations/{id}` | Customer(`members.manage`) | — | 204 | 404 |
| `DELETE /members/{userId}` | Customer(`members.manage`) | — | 204 | 409 `OWNER_REQUIRED`, 404 |

```json
{
  "owner": { "userId": "…", "displayName": "Lan", "email": "lan@example.vn" },
  "collaborators": [{ "userId": "…", "displayName": "Minh", "email": "minh@example.vn", "joinedAt": "…" }],
  "invitations": [{ "id": "…", "email": "ha@example.vn", "sentAt": "…", "expiresAt": "…" }],
  "seats": { "used": 2, "total": 2 }
}
```

- Tài khoản luôn lấy từ phiên; `{id}`, `{userId}` của tài khoản khác → 404 (RLS).
- `POST /members/invitations` phản hồi **giống nhau** dù email đã có người dùng hay chưa (FR-023).
- 429 khi quá 3 thư/giờ cho một email hoặc 10 lời mời mới/ngày của tài khoản.
- Gỡ: hiệu lực ≤ 60 giây trên mọi bản API (bộ nhớ đệm phiên của 004).

## 4. Lời mời – phía người được mời

| Phương thức, đường dẫn | Truy cập | Thân | Thành công | Lỗi |
|---|---|---|---|---|
| `POST /invitations/preview` | Public | `{ token }` | 200 `{ accountLabel, inviterName, email, expiresAt, mode }` | 400 `INVITE_INVALID` |
| `POST /invitations/accept` | Public | `{ token, displayName, password, acceptTerms: true, termsVersion }` | 200 `MeResponse` + cookie phiên | 400 `INVITE_INVALID`, 400 `VALIDATION_FAILED`, 409 `INVITE_EMAIL_IN_USE`, 409 `SEATS_FULL`; khi yêu cầu có phiên hợp lệ: 409 `ALREADY_IN_ACCOUNT` (đang là chủ/cộng tác viên), 409 `INVITE_EMAIL_MISMATCH` (ở tài khoản chờ, email khác) |
| `GET /invitations/mine` | Customer(+detached) | — | 200 `{ invitations: [{ id, accountLabel, inviterName, expiresAt }] }` (rỗng nếu không ở tài khoản chờ) | 401 |
| `POST /invitations/accept-existing` | Customer(+detached) | `{ token }` hoặc `{ invitationId }` | 200 `MeResponse` + cookie phiên **mới** | 400 `INVITE_INVALID`, 409 `ALREADY_IN_ACCOUNT`, 409 `INVITE_EMAIL_MISMATCH`, 409 `SEATS_FULL` |

- `mode` ∈ `new_user` (đặt tên + mật khẩu, hoặc Google/Facebook) | `login_required` (email đã có người
  dùng ở tài khoản chờ – đăng nhập rồi mở lại liên kết) | `in_use` (email đang thuộc tài khoản khác –
  FR-023, kèm cách khắc phục).
- Chấp nhận bằng Google/Facebook: `POST /auth/oauth/{provider}/start` với `purpose: 'invite'` (mục 1).
- Sau khi chấp nhận, chủ nhận thư "… đã tham gia" (việc `account.mail_notice`, tạo cùng giao dịch với
  việc chấp nhận).
- `accept` không bao giờ tạo người dùng mới đè lên một phiên đang có; người ở tài khoản chờ có email
  trùng dùng `accept-existing`.
- `accept-existing` cấp phiên mới nhưng **giữ mốc xác nhận lại danh tính** của phiên cũ (mục 2).
- `GET /invitations/mine` chỉ trả lời mời `pending`, chưa quá hạn, của tài khoản không `deleting`.

## 5. Người không thuộc tài khoản nào

| Phương thức, đường dẫn | Truy cập | Thân | Thành công | Lỗi |
|---|---|---|---|---|
| `POST /account/claim` | Customer(+detached) | `{ acceptTerms: true, termsVersion }` | 200 `MeResponse` (`account.status = 'active'`, `role = 'owner'`) + cookie phiên **mới** | 409 `ALREADY_IN_ACCOUNT` |

Mọi điểm cuối không có `+detached` trả 403 `NO_ACCOUNT` cho người ở tài khoản chờ. Phiên mới sau `claim`
giữ mốc xác nhận lại danh tính của phiên cũ (không tự thành "mới xác nhận").

## 6. Thông báo của Meta và trang trạng thái

| Phương thức, đường dẫn | Truy cập | Thân | Thành công | Lỗi |
|---|---|---|---|---|
| `POST /auth/facebook/deauthorize` | Public, miễn kiểm tra nguồn gửi | `application/x-www-form-urlencoded`: `signed_request` | 200 `{}` | 400 `SIGNED_REQUEST_INVALID` |
| `POST /auth/facebook/data-deletion` | Public, miễn kiểm tra nguồn gửi | như trên | 200 `{ "url": "{WEB}/data-deletion/{code}", "confirmation_code": "{code}" }` | 400 `SIGNED_REQUEST_INVALID` |
| `GET /public/data-deletion/{code}` | Public | — | 200 `{ status: 'completed' \| 'no_data', receivedAt }` | 404 |

- Chữ ký không hợp lệ hoặc thuật toán khác HMAC-SHA256 → 400, không có tác dụng phụ.
- Thông báo lặp, hoặc cho người dùng không tồn tại → 200 như bình thường với cùng mã xác nhận (`no_data`
  khi chưa từng có gì để gỡ). Bước gỡ luôn chạy lại: nếu danh tính Facebook đang tồn tại (đã liên kết lại,
  hoặc lần trước chưa gỡ xong) thì bị gỡ và có thư; nếu không còn thì không gửi thư lần hai.
- Trang trạng thái không có dữ liệu cá nhân.

## 7. Thay đổi ở điểm cuối của 004

| Điểm cuối | Thay đổi |
|---|---|
| `GET /auth/me`, `POST /auth/logout`, `POST /auth/logout-all` | thêm `+detached`; `MeResponse.account.status` có thể là `unclaimed` (khi đó `permissions = []`) |
| `POST /auth/login` | người ở tài khoản chờ đăng nhập được (trước đây 403 khi membership `removed`) |
| `POST /auth/password/forgot` | gửi thư cả khi người dùng chưa có mật khẩu (FR-017); phản hồi không đổi |
| `POST /auth/password/reset` | tạo cách đăng nhập `password` nếu chưa có; kiểm toán `auth.password.set` |
| `POST /auth/password/change`, `PATCH /auth/email`, `POST /auth/email/resend` | thêm `+detached` |

## 8. Mã lỗi mới

| Mã | HTTP | Thông điệp | `actions` |
|---|---|---|---|
| `OAUTH_CANCELLED` | 400 | "Bạn chưa hoàn tất đăng nhập bằng {Google/Facebook}." | `retry`, `navigate` → `/login` |
| `OAUTH_FAILED` | 400 | "Chưa đăng nhập được bằng {…}. Hãy thử lại hoặc đăng nhập bằng email." | `retry`, `navigate` → `/login` |
| `OAUTH_FLOW_INVALID` | 400 | "Phiên đăng nhập này đã hết hạn. Hãy bắt đầu lại." | `navigate` → `/login` |
| `PROVIDER_UNAVAILABLE` | 503 | "{…} đang gặp sự cố. Bạn có thể đăng nhập bằng cách khác." | `navigate` → `/login` |
| `IDENTITY_IN_USE` | 409 | "Tài khoản {…} này đang dùng cho một tài khoản khác." | `navigate` → cách đăng nhập |
| `PROVIDER_ACCOUNT_CONFLICT` | 409 | "Email này đã liên kết với một tài khoản {…} khác. Hãy đăng nhập bằng cách bạn vẫn dùng." | `navigate` → `/login` |
| `LOGIN_METHOD_EXISTS` | 409 | "Bạn đã liên kết cách đăng nhập này rồi." | `navigate` → cách đăng nhập |
| `LAST_LOGIN_METHOD` | 409 | "Hãy thêm cách đăng nhập khác trước khi gỡ." | `navigate` → cách đăng nhập |
| `REAUTH_REQUIRED` | 403 | "Hãy xác nhận lại đây là bạn để tiếp tục." | `reauth` (kind mới) |
| `REAUTH_MISMATCH` | 400 | "Tài khoản {…} vừa chọn không phải cách đăng nhập của bạn." | `retry` |
| `INVITE_INVALID` | 400 | "Lời mời không còn hiệu lực. Hãy nhờ chủ tài khoản gửi lại lời mời." | `contact_owner` |
| `INVITE_EMAIL_MISMATCH` | 409 | "Hãy dùng tài khoản có email {email được mời} hoặc nhờ chủ tài khoản mời lại bằng email này." | `retry`, `contact_owner` |
| `INVITE_EMAIL_IN_USE` | 409 | "Email này đang dùng cho một tài khoản khác nên chưa tham gia được." | `contact_owner` (mời bằng email khác) |
| `INVITE_SELF` | 400 | "Bạn đang là chủ tài khoản này." | `fix_input` |
| `ALREADY_IN_ACCOUNT` | 409 | "Bạn đang thuộc một tài khoản khác." | `navigate` → `/` |
| `NO_ACCOUNT` | 403 | "Bạn không còn là thành viên của tài khoản nào." | `navigate` → `/no-account` |
| `SIGNED_REQUEST_INVALID` | 400 | (máy gọi máy) | — |

`SEATS_FULL` (sẵn có) đổi thông điệp: "Đã đủ 2 cộng tác viên. Gỡ một người hoặc hủy một lời mời để mời
người khác." Mã lỗi gốc của nhà cung cấp chỉ nằm ở `support.detail`.

## 9. Cookie

| Tên | Thuộc tính | Hết hạn |
|---|---|---|
| `__Host-oauth` | `HttpOnly; Secure; SameSite=Lax; Path=/` | 30 phút; xóa khi lượt kết thúc |

`SameSite=Lax` để cookie đi kèm lần chuyển hướng `GET` từ nhà cung cấp về.
