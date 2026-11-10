# Data model – 004 Xác thực tối thiểu

Mọi bảng thuộc schema `account` (module `account`), định nghĩa ở
`apps/server/src/modules/account/internal/db/schema.ts`. Bảng `tenant` dựng bằng `tenantTable` của
002, nên tự có bộ cột chuẩn (`id` UUID v7, `account_id NOT NULL` FK cascade tới `account.accounts`,
`created_at`, `updated_at`), chỉ mục bắt đầu bằng `account_id` và chính sách `tenant_isolation`. Bảng
`shared` dựng bằng `sharedTable(..., { reason })`. Thời gian là `timestamptz` UTC.

## 1. Bảng gốc `account.accounts` (đã có ở 002, không đổi cấu trúc)

`status ∈ {active, suspended, expired, deleting}`. Đăng ký tạo `active`. Đăng nhập bị chặn khi
`deleting` hoặc khi `deleted_at IS NOT NULL`; ba trạng thái còn lại vẫn đăng nhập được (Edge Cases).
Vai trò `app` không có quyền INSERT; chỉ `auth_register` (mục 4) tạo được tài khoản.

## 2. Bảng tenant

### `account.users` – người dùng khách hàng

| Cột | Kiểu | Ràng buộc / ghi chú |
|---|---|---|
| (chuẩn) | | `account_id` = tài khoản duy nhất của người dùng ở giai đoạn 1 |
| `display_name` | text | 1–80 ký tự sau `trim` |
| `email` | text | dạng hiển thị (đã cắt khoảng trắng) |
| `email_normalized` | text | `trim` → NFC → chữ thường. **Duy nhất toàn cục**: `users_email_normalized_key`, ngoại lệ quy tắc `d` với lý do "email duy nhất trên mọi tài khoản – FR-002" |
| `email_verified_at` | timestamptz NULL | NULL = chưa xác minh (FR-008a) |
| `status` | text | `active` \| `disabled`; `CHECK` |
| `terms_version` | text | phiên bản điều khoản đã đồng ý |
| `terms_accepted_at` | timestamptz | |
| `password_changed_at` | timestamptz NULL | |

### `account.login_identities` – cách đăng nhập

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| (chuẩn) | | |
| `user_id` | uuid | FK `users(id)` ON DELETE CASCADE (trong module) |
| `provider` | text | `password` \| `google` \| `facebook`; `CHECK` |
| `provider_subject` | text | với `password` thì bằng `user_id` |
| `password_hash` | text NULL | chuỗi PHC argon2id. `CHECK ((provider = 'password') = (password_hash IS NOT NULL))` |
| `last_used_at` | timestamptz NULL | |

Duy nhất toàn cục `(provider, provider_subject)` (ngoại lệ quy tắc `d`, FR-003). Duy nhất `(account_id,
user_id, provider)`.

### `account.memberships` – vai trò trong tài khoản

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| (chuẩn) | | |
| `user_id` | uuid | FK `users(id)` |
| `role` | text | `owner` \| `collaborator` |
| `seat` | smallint | `CHECK (seat BETWEEN 0 AND 2)`, `CHECK ((role = 'owner') = (seat = 0))` |
| `status` | text | `active` \| `removed` \| `disabled` |
| `added_by_user_id` | uuid NULL | |

- Duy nhất `(account_id, seat) WHERE status = 'active'` bảo đảm đúng 1 chủ và tối đa 2 cộng tác viên
  (R5).
- Duy nhất `(account_id, user_id)`.
- Không chuyển được membership của chủ sang `removed`/`disabled`: dịch vụ chặn và trả 409
  `OWNER_REQUIRED`. `CHECK (role <> 'owner' OR status = 'active')` chặn thêm ở CSDL.

Trạng thái: `active → removed` (gỡ), `active ↔ disabled` (khóa/mở). Mỗi chuyển đổi ghi kiểm toán và
thu hồi mọi phiên của người đó trong tài khoản (≤ 60 giây ở bản API khác).

### `account.sessions` – phiên khách hàng

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| (chuẩn) | | |
| `user_id` | uuid | FK `users(id)` |
| `token_hash` | bytea | `sha256(token)`, 32 byte. Duy nhất toàn cục (ngoại lệ quy tắc `d`: tra theo mã trước khi biết tenant) |
| `last_seen_at` | timestamptz | |
| `idle_expires_at` | timestamptz | `last_seen_at + idle` |
| `absolute_expires_at` | timestamptz | `created_at + 30 ngày` |
| `revoked_at` | timestamptz NULL | |
| `revoke_reason` | text NULL | `logout` \| `logout_all` \| `password_changed` \| `password_reset` \| `email_verified` \| `member_removed` \| `user_disabled` |
| `user_agent_summary` | text NULL | vd "Chrome · Android", ≤ 60 ký tự, không lưu chuỗi UA đầy đủ |

Chỉ mục `(account_id, user_id) WHERE revoked_at IS NULL` để thu hồi hàng loạt. Phiên hiệu lực khi
`revoked_at IS NULL AND now() < idle_expires_at AND now() < absolute_expires_at`. Dòng hết hạn quá 30
ngày sẽ bị việc định kỳ xóa (đăng ký khi có 003).

### `account.auth_tokens` – mã một lần

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| (chuẩn) | | |
| `user_id` | uuid | FK `users(id)` |
| `purpose` | text | `verify_email` \| `reset_password` |
| `token_hash` | bytea | duy nhất toàn cục (ngoại lệ quy tắc `d`) |
| `email_normalized` | text | email mà mã áp dụng (với `verify_email`: email tại lúc gửi) |
| `expires_at` | timestamptz | verify: +24 giờ; reset: +30 phút |
| `used_at` | timestamptz NULL | đặt khi dùng **hoặc** khi có mã mới cùng mục đích thay thế |

Chuyển trạng thái `chưa dùng → đã dùng` chỉ bằng `UPDATE … WHERE used_at IS NULL AND expires_at >
now()` (R8).

## 3. Bảng shared (không có `account_id`)

| Bảng | `reason` (sổ đăng ký) | Cột chính |
|---|---|---|
| `account.staff_users` | "Nhân viên nội bộ không thuộc tài khoản khách hàng – FR-016" | `id`, `email_normalized` (duy nhất), `display_name`, `role` (`support` \| `admin`), `password_hash`, `status` (`active` \| `disabled`), `created_at`, `updated_at`, `password_changed_at` |
| `account.staff_sessions` | "Phiên của nhân viên nội bộ – FR-010, FR-016" | như `sessions`, thay `user_id` bằng `staff_user_id` (FK `staff_users`), không có `account_id`; thêm `assurance text NOT NULL DEFAULT 'password'` (R10), `ip` (inet) |
| `account.auth_throttle` | "Bộ đếm chống dò theo email/địa chỉ mạng trước khi biết tenant – FR-007" | PK `(kind, key_hash)`; `window_start`, `count int`, `blocked_until timestamptz NULL` |

Quyền: theo quyền mặc định của schema `account` (002), `app` và `system` có DML. Không cấp quyền nào
cho `support`. `password_hash` của nhân viên chỉ đọc được qua `authTx` (ranh giới R4).

## 4. Hàm `SECURITY DEFINER` (migration tay)

Chung cho cả 4 hàm: `OWNER owner`, `SET search_path = pg_catalog, account`, `REVOKE ALL FROM PUBLIC`,
`GRANT EXECUTE TO "app"`. Không cấp cho `system` hay `support`. Đầu vào là giá trị đã chuẩn hóa hoặc
băm ở ứng dụng. Hàm không ghi nhật ký, không trả cột nào ngoài danh sách dưới đây.

| Hàm | Đầu vào | Trả về | Hành vi |
|---|---|---|---|
| `auth_register` | `p_account_id, p_user_id, p_identity_id, p_membership_id, p_token_id uuid; p_display_name, p_email, p_email_normalized, p_password_hash, p_terms_version text; p_token_hash bytea; p_token_expires_at timestamptz` | `text`: `'created'` \| `'email_taken'` | Một khối: INSERT `accounts(status='active')`, `users`, `login_identities(password)`, `memberships(owner, seat 0)`, `auth_tokens(verify_email)`. Gặp `unique_violation` trên `users_email_normalized_key` thì hoàn tác khối và trả `'email_taken'`. Lỗi khác thì ném. Mã do ứng dụng sinh (UUID v7). |
| `auth_lookup_email` | `p_email_normalized text` | 0–1 dòng `(user_id, account_id, display_name, password_hash, user_status, member_status, account_status, email_verified_at)` | Chỉ khớp chính xác email; bỏ qua tài khoản có `deleted_at`. Không có wildcard, không tìm theo tiền tố. |
| `auth_resolve_session` | `p_token_hash bytea, p_touch_after interval, p_idle interval` | 0–1 dòng `(session_id, user_id, account_id, role, email_verified, display_name, absolute_expires_at)` | Chỉ trả khi phiên còn hiệu lực, `users.status = 'active'`, membership `active` và tài khoản không `deleting`/đã xóa. Nếu `now() - last_seen_at > p_touch_after` thì cập nhật `last_seen_at` và `idle_expires_at` (`VOLATILE`). |
| `auth_find_token` | `p_token_hash bytea, p_purpose text` | 0–1 dòng `(token_id, account_id, user_id, email_normalized)` | Chỉ khi `used_at IS NULL AND expires_at > now()`. Không tiêu thụ mã: việc tiêu thụ làm trong `tenantTx` (R8). |

Kiểm thử bắt buộc (`auth-functions.db.spec.ts`): vai trò `support`/`system` gọi thì bị từ chối;
kết quả chỉ có đúng các cột trên; `auth_register` đồng thời cùng email thì đúng 1 `'created'`;
phiên bị thu hồi/hết hạn/của người bị khóa thì 0 dòng.

## 5. Thay đổi bảng sẵn có

- `infra.audit_log.actor_type`: `CHECK` mở rộng thành `{support, admin, system, user, anonymous}`
  (migration tay, tương thích ngược – R11).

## 6. Migration (thứ tự)

| Tệp | Loại | Nội dung |
|---|---|---|
| `0009_account_auth_tables.sql` | sinh (drizzle-kit) | 8 bảng mục 2–3, chỉ mục, `CHECK`, chính sách `tenant_isolation` |
| `0010_account_auth_functions.sql` | tay | 4 hàm mục 4 + quyền |
| `0011_audit_actor_types.sql` | tay | mở rộng `CHECK` mục 5 |

Mọi thay đổi đều chỉ thêm. API/Worker bản cũ (chưa biết các bảng này) vẫn chạy được (hiến pháp: tương
thích ngược). `pnpm db:check` phải không có vi phạm. Mọi chỉ mục toàn cục đã liệt kê đều có lý do trong
`indexExceptions`.

## 7. Đối tượng trong bộ nhớ (không lưu CSDL)

- **`Actor`** (gắn vào `ExecutionContext`): `{ kind: 'user'; userId; accountId; role: 'owner' |
  'collaborator'; emailVerified; sessionId }` hoặc `{ kind: 'staff'; staffId; role: 'support' | 'admin';
  sessionId }`.
- **Bộ nhớ đệm phiên**: `Map<token_hash_hex, { actor; expiresAt = min(now + 60 giây,
  absolute_expires_at) }>`, tối đa 10.000 mục, khi đầy thì bỏ mục cũ nhất (thứ tự chèn của `Map`).
  Không bao giờ lưu mã gốc.
- **Danh mục quyền**: [contracts/authz-api.md](contracts/authz-api.md) mục 1.

## 8. Dữ liệu cá nhân (bổ sung danh mục, Kiến trúc dữ liệu mục 9)

| Dữ liệu | Nơi lưu | Thời hạn / xóa |
|---|---|---|
| Email, tên hiển thị của khách | `users` | xóa dây chuyền khi xóa tài khoản (FR-14) |
| Băm mật khẩu | `login_identities` | như trên; không bao giờ rời CSDL ngoài lúc kiểm tra |
| Tóm tắt thiết bị của phiên | `sessions` | như trên; dòng hết hạn bị dọn sau 30 ngày |
| Địa chỉ mạng ở nhật ký kiểm toán | `infra.audit_log.metadata` | 12 tháng theo phân vùng; ẩn danh hóa khi xóa tài khoản |
| Email/địa chỉ mạng trong bộ đếm | `auth_throttle` – chỉ có HMAC | ≤ 24 giờ |
| Email, tên nhân viên | `staff_users` | đến khi nhân viên bị xóa bằng lệnh vận hành |

Không có bên nhận mới ở nước ngoài. SES (đã có trong bảng công nghệ) nhận địa chỉ thư và nội dung thư.
