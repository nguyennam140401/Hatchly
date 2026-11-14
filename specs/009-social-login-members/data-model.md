# Data model – 009 Đăng nhập Google / Facebook, cách đăng nhập, mời / gỡ cộng tác viên

Mọi bảng thuộc schema `account`, định nghĩa ở `apps/server/src/modules/account/internal/db/schema.ts`
(riêng `accounts` ở `core/db/tenant-root.ts`). Bảng tenant dựng bằng `tenantTable` (cột chuẩn `id` UUID
v7, `account_id`, `created_at`, `updated_at`, RLS `tenant_isolation`); bảng dùng chung bằng
`sharedTable(..., { reason })`. Thời gian `timestamptz` UTC. Nền: [data-model của 004](../004-minimal-auth-rbac/data-model.md).

## 1. Thay đổi bảng sẵn có (chỉ thêm, trừ bỏ một khóa ngoại)

| Bảng | Thay đổi | Ghi chú |
|---|---|---|
| `account.accounts` | `CHECK status` thêm `'unclaimed'` | Tài khoản chờ của người không thuộc tài khoản nào (research R6). Không có gói, hồ sơ, kênh. |
| `account.users` | `+ detached_at timestamptz NULL`, `+ deletion_notice_sent_at timestamptz NULL` | Đặt khi bị gỡ; về NULL khi nhận tài khoản. `CHECK (deletion_notice_sent_at IS NULL OR detached_at IS NOT NULL)`. |
| `account.login_identities` | `+ provider_email text NULL`, `+ provider_display_name text NULL` | Email/tên phía nhà cung cấp lúc liên kết (FR-014). `CHECK (provider <> 'password' OR (provider_email IS NULL AND provider_display_name IS NULL))`. Ngày liên kết = `created_at`. |
| `account.sessions` | `+ reauthenticated_at timestamptz NULL`; `revoke_reason` thêm `identity_link_reset`, `account_joined`, `account_claimed` | Research R11, R7. Phiên "mới xác nhận" = `coalesce(reauthenticated_at, created_at) ≥ now() − 10 phút`; phiên do xoay vòng (`claim`, `accept-existing`) mang `reauthenticated_at` = mốc của phiên cũ. |
| `account.memberships` | **bỏ khóa ngoại** `user_id → users.id` (`ON DELETE CASCADE`); `user_id` thành mã tham chiếu, vẫn `NOT NULL` | Sau `member_detach`, dòng `users` sang tài khoản chờ còn dòng `removed` ở lại tài khoản cũ; giữ khóa ngoại thì xóa người dùng sau 90 ngày sẽ xóa dây chuyền dòng này ở **tenant khác**. Bỏ khóa ngoại để dòng `removed` được giữ cho truy vết (spec – Key Entities). Dòng của tài khoản vẫn bị xóa theo tài khoản (khóa ngoại `account_id`). Ràng buộc ghế của 004 giữ nguyên. |
| `account.auth_throttle` | `kind` thêm `mail_invite`, `invite_account`, `mail_link_confirm`, `oauth_start_ip` | Mục 5. |

Không đổi: `auth_tokens`. Vì `memberships.user_id` không còn khóa ngoại, mọi nơi xóa một dòng `users`
riêng lẻ (hiện chỉ có xóa dây chuyền theo tài khoản) không tự xóa `memberships`; các hàm ở mục 4 tự xử lý
dòng `memberships` mà chúng tạo/chuyển.

## 2. Bảng tenant mới

### `account.invitations` – lời mời cộng tác viên

| Cột | Kiểu | Ràng buộc / ghi chú |
|---|---|---|
| (chuẩn) | | `account_id` = tài khoản mời |
| `email` | text | dạng hiển thị |
| `email_normalized` | text | cùng cách chuẩn hóa với `users` |
| `invited_by_user_id` | uuid | người mời (chủ) |
| `role` | text | `collaborator`; `CHECK` |
| `seat` | smallint | `CHECK (seat BETWEEN 1 AND 2)` |
| `status` | text | `pending` \| `accepted` \| `cancelled` \| `expired`; `CHECK` |
| `token_hash` | bytea | SHA-256 của mã trong liên kết; đổi mỗi lần "Gửi lại" |
| `account_label` | text NULL | tên cửa hàng lúc gửi (research R17), ≤ 120 ký tự |
| `last_sent_at` | timestamptz | |
| `expires_at` | timestamptz | `last_sent_at + 7 ngày` |
| `accepted_user_id` | uuid NULL | |
| `closed_at` | timestamptz NULL | thời điểm rời `pending` |

- Duy nhất `(account_id, seat) WHERE status = 'pending'` – chốt chặn ghế (R9).
- Duy nhất `(account_id, email_normalized) WHERE status = 'pending'` – mời lại email đang chờ = "Gửi lại".
- Duy nhất toàn cục `token_hash` (ngoại lệ có lý do: tra lời mời trước khi biết tenant).
- Chỉ mục `(email_normalized) WHERE status = 'pending'` (ngoại lệ có lý do: liệt kê lời mời của một
  email – FR-027).

Trạng thái (mọi chuyển đổi là `UPDATE … WHERE status = 'pending'`):

```text
pending ──chấp nhận──▶ accepted
pending ──chủ hủy / tài khoản bị yêu cầu xóa──▶ cancelled
pending ──quá expires_at (việc định kỳ hoặc dọn tại chỗ)──▶ expired
pending ──Gửi lại──▶ pending (token_hash, last_sent_at, expires_at mới)
```

### `account.former_members` – tên của thành viên đã gỡ

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| (chuẩn) | | |
| `user_id` | uuid | mã tham chiếu, **không** khóa ngoại (người dùng đã rời tenant, có thể đã bị xóa) |
| `display_name` | text | tên lúc bị gỡ |
| `removed_at` | timestamptz | |
| `removed_by_user_id` | uuid | |

Duy nhất `(account_id, user_id)`. Xóa khi người đó tham gia lại tài khoản này, hoặc sau 12 tháng.
Không lưu email.

## 3. Bảng dùng chung mới (không `account_id`, chỉ truy cập qua `authTx`)

### `account.oauth_flows` – lượt đăng nhập qua nhà cung cấp + phần chờ xác nhận

`reason`: "Lượt đăng nhập qua nhà cung cấp và yêu cầu xác nhận liên kết xảy ra trước khi biết tenant –
FR-007, FR-010".

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `flow_token_hash` | bytea, duy nhất | SHA-256 của cookie `__Host-oauth` |
| `state_hash` | bytea | SHA-256 của `state` gửi nhà cung cấp |
| `code_verifier` | text NULL | chỉ Google; xóa (NULL) ngay khi quay về |
| `provider` | text | `google` \| `facebook` |
| `purpose` | text | `login` \| `link` \| `reauth` \| `invite` |
| `stage` | text | xem sơ đồ dưới |
| `actor_user_id` | uuid NULL | người đang đăng nhập (`link`, `reauth`) |
| `invitation_id` | uuid NULL | (`invite`) |
| `terms_version`, `terms_accepted_at` | text, timestamptz NULL | ô đồng ý đã tích |
| `provider_subject` | text NULL | có sau khi quay về |
| `provider_email`, `provider_email_verified`, `provider_display_name` | text, boolean, text NULL | |
| `claimed_email`, `claimed_email_normalized`, `display_name` | text NULL | người dùng nhập ở bước hoàn tất |
| `target_user_id`, `target_tenant_id` | uuid NULL | người dùng đã có cần xác nhận liên kết |
| `password_allowed` | boolean | cách (a) của FR-011 được phép |
| `mail_token_hash` | bytea NULL, duy nhất | băm mã trong liên kết gửi email |
| `result_code` | text NULL | mã kết quả/lỗi cho web (không phải mã của nhà cung cấp) |
| `expires_at` | timestamptz | theo giai đoạn (R5) |
| `created_at`, `updated_at`, `closed_at` | timestamptz | |

```text
started ──quay về hợp lệ──▶ signed_in            (danh tính đã liên kết → đã cấp phiên)       [kết thúc]
        │                 ▶ needs_signup         (email đã xác minh, chưa có người dùng)      30 phút
        │                 ▶ needs_email          (không có email / email chưa xác minh)       30 phút
        │                 ▶ needs_link_confirm   (email đã xác minh trùng người dùng đã có)   30 phút
        │                 ▶ completed            (link / reauth / invite xong)                [kết thúc]
        └──hủy, lỗi, quá 10 phút, state sai──▶ failed                                        [kết thúc]
needs_signup ──đồng ý + tên──▶ completed (tạo tài khoản, cấp phiên)
needs_email ──nhập email + đồng ý──▶ awaiting_email (gửi thư; 24 giờ nếu email mới, 30 phút nếu trùng)
needs_link_confirm ──đúng mật khẩu──▶ completed
needs_link_confirm ──"Gửi liên kết"──▶ awaiting_email (30 phút)
awaiting_email ──mở liên kết trong thư──▶ completed (tạo tài khoản hoặc liên kết; cấp phiên)
```

Mọi chuyển giai đoạn: `UPDATE … WHERE id = $1 AND stage = $expected AND expires_at > now()`. Gửi lại
liên kết đặt `mail_token_hash` mới (liên kết cũ hết hiệu lực). Dòng đã kết thúc hoặc quá hạn > 24 giờ bị
việc định kỳ xóa.

### `account.meta_deletion_requests`

`reason`: "Yêu cầu của Meta không gắn tài khoản khách hàng và trang trạng thái là công khai – FR-009a".

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `confirmation_code` | text, duy nhất | ngẫu nhiên 16 byte, base64url |
| `kind` | text | `deauthorize` \| `data_deletion` |
| `subject_hmac` | bytea | HMAC(bí mật máy chủ, mã người dùng Facebook) – nhận ra thông báo lặp, không lưu mã rõ |
| `status` | text | `completed` \| `no_data` |
| `received_at` | timestamptz | |

Duy nhất `(kind, subject_hmac)`: thông báo lặp trả lại cùng mã xác nhận (`ON CONFLICT … DO UPDATE SET
received_at = now()`), **nhưng bước gỡ danh tính luôn chạy lại** – không còn danh tính thì không làm gì.
Nhờ vậy người gỡ ứng dụng, liên kết lại Facebook rồi gỡ lần hai vẫn được xử lý, và tiến trình chết giữa
chừng được hoàn tất ở lần gửi lại. Dòng mới tạo với `status = 'no_data'`, chuyển `completed` khi đã xóa
được danh tính. Giữ 12 tháng.

## 4. Hàm `SECURITY DEFINER` (migration tay)

Chung như 004: `OWNER owner`, `SET search_path = pg_catalog, account`, `REVOKE ALL FROM PUBLIC`, đầu vào
đã chuẩn hóa/băm ở ứng dụng, mã (UUID v7) do ứng dụng sinh, hàm không ghi nhật ký, chỉ trả các cột liệt
kê. Chữ ký chi tiết chốt ở bước tasks, hành vi dưới đây là bắt buộc.

### Cấp cho `app`

| Hàm | Trả về | Hành vi |
|---|---|---|
| `auth_resolve_session_v2(token_hash, touch_after, idle)` | như bản cũ + `detached boolean` | `detached = (accounts.status = 'unclaimed')`. Hàm cũ giữ nguyên cho bản API cũ. |
| `auth_lookup_identity(provider, provider_subject)` | 0–1 dòng `(user_id, account_id, user_status, member_status, account_status, email_verified_at)` | Khớp chính xác; bỏ qua tài khoản đã xóa. |
| `auth_register_oauth(ids…, display_name, email, email_normalized, email_verified, provider, provider_subject, provider_email, provider_display_name, terms_version)` | `'created'` \| `'email_taken'` \| `'identity_taken'` | Một khối: `accounts(active)` + `users` + `login_identities(provider)` + `memberships(owner, 0)`. |
| `auth_find_invitation(token_hash)` | 0–1 dòng `(invitation_id, account_id, email, email_normalized, account_label, inviter_display_name, expires_at, existing_user_state)` | Chỉ khi `pending`, chưa quá hạn, tài khoản không `deleting`/đã xóa. `existing_user_state ∈ {none, detached, member}` cho email được mời. |
| `auth_pending_invitations_for_email(email_normalized)` | các dòng `(invitation_id, account_label, inviter_display_name, expires_at)` | Chỉ lời mời `pending`, chưa quá hạn, của tài khoản không `deleting`/đã xóa. Ứng dụng chỉ gọi với email **đã xác minh của phiên**. |
| `auth_accept_invitation_new(invitation_id, token_hash, user_id, identity_id, membership_id, display_name, password_hash NULL, provider NULL, provider_subject NULL, provider_email NULL, provider_display_name NULL, terms_version)` | `'accepted'` \| `'invalid'` \| `'email_in_use'` \| `'identity_taken'` \| `'seat_taken'` | Khóa ghế → kiểm lời mời → tạo `users` (email của lời mời, đã xác minh) + một danh tính + `memberships(collaborator, seat của lời mời)` → `accepted`. |
| `auth_accept_invitation_existing(invitation_id, user_id)` | `'accepted'` \| `'invalid'` \| `'email_mismatch'` \| `'not_eligible'` \| `'seat_taken'` | `invalid`: lời mời không `pending`, quá hạn, hoặc tài khoản mời `deleting`/đã xóa. `email_mismatch`: email đã xác minh của người dùng khác email lời mời (hoặc email chưa xác minh). `not_eligible`: người dùng không `active` hoặc tài khoản hiện tại không `unclaimed`. Đạt: chuyển `users`, `login_identities` sang tài khoản mời; xóa `sessions`, `auth_tokens` của người đó; `memberships` thêm mới hoặc kích hoạt lại dòng `removed`; xóa `former_members` tương ứng; `detached_at = NULL` và `deletion_notice_sent_at = NULL`; xóa tài khoản chờ. |
| `member_detach(user_id, shell_account_id, shell_membership_id, former_id, removed_by_user_id)` | `'detached'` \| `'not_found'` \| `'owner'` | Tài khoản lấy từ `account.current_account_id()` (không nhận tham số). Membership `collaborator` `active`/`disabled` → `removed`; ghi `former_members`; tạo `accounts(unclaimed)`; chuyển `users`, `login_identities`; xóa `sessions`, `auth_tokens`; tạo `memberships(owner, 0)` ở tài khoản chờ; `detached_at = now()`. |

### Cấp cho `system` (chỉ Worker)

| Hàm | Trả về | Hành vi |
|---|---|---|
| `detached_users_due(kind, limit, retention_days, notice_days)` | các dòng `(account_id, user_id)` | `kind = 'notice'`: `detached_at ≤ now() − (retention_days − notice_days) ngày` và chưa báo. `kind = 'purge'`: `detached_at ≤ now() − retention_days ngày` và `deletion_notice_sent_at ≤ now() − notice_days ngày`. Mặc định 90 / 7 (cấu hình `DETACHED_RETENTION_DAYS`, `DETACHED_NOTICE_DAYS`). Chỉ tài khoản `unclaimed`. |
| `purge_detached_account(account_id, retention_days, notice_days)` | boolean | Kiểm lại đủ điều kiện `purge` trong cùng câu lệnh rồi `DELETE` tài khoản chờ (xóa dây chuyền `users`, `login_identities`, `sessions`, dòng `memberships` của tài khoản chờ). Dòng `memberships` `removed` ở tài khoản cũ **không** bị đụng. Không đủ điều kiện → `false`, không làm gì. |
| `auth_housekeeping()` | các dòng `(account_id, invitation_id)` của lời mời vừa chuyển `expired` | `pending` quá hạn → `expired`; xóa `invitations` đã đóng > 90 ngày; xóa `former_members` > 12 tháng. (`oauth_flows`, `meta_deletion_requests` là bảng dùng chung – Worker xóa trực tiếp.) |

Kiểm thử bắt buộc (`social-functions.db.spec.ts`): vai trò không được cấp gọi thì bị từ chối; kết quả chỉ
có đúng các cột trên; chấp nhận đồng thời khi còn 1 chỗ → đúng 1 `'accepted'`; `member_detach` với chủ →
`'owner'`; `purge_detached_account` với tài khoản `active` hoặc chưa đủ ngày → `false`.

## 5. Bộ đếm (`auth_throttle`)

| `kind` | Khóa | Ngưỡng mặc định |
|---|---|---|
| `mail_invite` | email được mời | 3 / 60 phút |
| `invite_account` | mã tài khoản | 10 lời mời mới / 24 giờ |
| `mail_link_confirm` | email đích | 3 / 60 phút (dùng chung cho thư xác nhận liên kết và hoàn tất đăng ký) |
| `oauth_start_ip` | địa chỉ mạng | 30 / 60 phút |
| `login_email` (sẵn có) | email | mật khẩu sai ở xác nhận liên kết và ở xác nhận lại danh tính tính chung bộ đếm đăng nhập (FR-011) |

## 6. Quy tắc nghiệp vụ gắn với dữ liệu

- **Một danh tính nhà cung cấp – một người dùng**: `login_identities_provider_subject_key` (sẵn có).
- **Mỗi loại tối đa một**: `login_identities_account_user_provider_key` (sẵn có). Ở luồng trùng email,
  nếu người dùng đã có một danh tính cùng nhà cung cấp thì không đưa vào xác nhận liên kết: email nhà
  cung cấp đã xác minh → `PROVIDER_ACCOUNT_CONFLICT`; email tự nhập → vẫn "Hãy kiểm tra email", gửi thư
  thông tin `identity_link_blocked` (không mã) cho người dùng đã có.
- **Tối thiểu một cách đăng nhập**: khóa dòng + đếm trong giao dịch (R13); ngoại lệ: gỡ theo Meta.
- **Chỗ cộng tác viên**: ghế `memberships` đang `active` ∪ ghế `invitations` đang `pending` ⊆ {1, 2},
  dưới khóa `account.seats:{account_id}` (R9).
- **Một người dùng – một tài khoản**: người đang ở tài khoản không phải `unclaimed` không chấp nhận được
  lời mời (`not_eligible` / `email_in_use`).
- **Email chưa xác minh bị chiếm lại (FR-011)**: khi xác nhận liên kết qua email cho người dùng có
  `email_verified_at IS NULL`: xóa dòng `password`, thu hồi mọi phiên (`identity_link_reset`), đặt
  `email_verified_at = now()`.

## 7. Hành động kiểm toán (`infra.audit_log.action`)

`auth.oauth.succeeded` · `auth.oauth.failed` (`reason`: `cancelled`, `state_mismatch`, `expired`,
`provider_error`, `account_unavailable`) · `auth.register.oauth` · `auth.identity.link_requested` ·
`auth.identity.link_confirmed` · `auth.identity.link_denied` · `auth.identity.linked` ·
`auth.identity.unlinked` · `auth.identity.unlinked_by_provider` · `auth.password.set` · `auth.reauth` ·
`account.invitation.sent` · `account.invitation.resent` · `account.invitation.cancelled` ·
`account.invitation.accepted` · `account.invitation.expired` · `account.member.removed` (sẵn có) ·
`account.claimed` · `account.user.purged`.

`metadata` chỉ có `{ ip, ua_family, reason, provider }` – không email, không mã, không liên kết. Hành động
trước khi biết tenant ghi bằng `authTx` với `account_id = NULL`.

## 8. Migration

| Tệp | Loại | Nội dung |
|---|---|---|
| `0014_account_social_members_tables.sql` | sinh (drizzle-kit) | Mục 1–3: cột mới, 4 bảng, chỉ mục, `CHECK` mở rộng, chính sách RLS, bỏ khóa ngoại `memberships.user_id → users.id` |
| `0015_account_social_members_functions.sql` | tay | Hàm mục 4 + quyền |

Chỉ thêm, ngoại trừ một `DROP CONSTRAINT` (khóa ngoại nêu trên – tương thích ngược, bản API cũ không
dựa vào nó); hàm `auth_resolve_session` cũ được giữ. `pnpm db:check` không vi phạm; mọi chỉ mục toàn cục có
lý do trong `indexExceptions`. Số tệp đánh lại nếu trùng khi hợp nhất (R20).

## 9. Đối tượng trong bộ nhớ và kiểu dùng chung

- `CustomerActor` thêm `detached: boolean`.
- `MeResponse.account.status` thêm `'unclaimed'`; khi đó `permissions = []`.
- `ProviderProfile` (nội bộ): `{ provider, subject, email?, emailVerified, displayName? }` – không có mã
  quyền.

## 10. Dữ liệu cá nhân (bổ sung danh mục)

| Dữ liệu | Nơi lưu | Thời hạn / xóa |
|---|---|---|
| Mã người dùng, email, tên phía Google/Facebook | `login_identities` | đến khi gỡ cách đăng nhập, Meta báo gỡ, hoặc xóa tài khoản |
| Hồ sơ nhà cung cấp và email tự nhập của lượt đang chờ | `oauth_flows` | ≤ 24 giờ, rồi việc định kỳ xóa |
| Email được mời | `invitations` | xóa 90 ngày sau khi lời mời đóng; xóa dây chuyền theo tài khoản |
| Tên thành viên đã gỡ | `former_members` | 12 tháng |
| Người dùng ở tài khoản chờ | `users`, `login_identities` | xóa sau 90 ngày không thuộc tài khoản nào (báo trước 7 ngày) |
| Yêu cầu của Meta | `meta_deletion_requests` | chỉ HMAC + mã xác nhận; 12 tháng |

Bên nhận/chuyển dữ liệu ở nước ngoài mới: **Google** và **Meta** (đăng nhập) – chiều nhận về tên, email,
mã người dùng; chiều gửi đi chỉ có tham số giao thức. Phải thêm vào danh sách chuyển dữ liệu xuyên biên
giới (Kiến trúc dữ liệu mục 9) và màn hình đồng ý/chính sách quyền riêng tư (FR-032).
