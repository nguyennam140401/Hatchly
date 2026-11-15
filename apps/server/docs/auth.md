# Xác thực và phân quyền – hướng dẫn cho lập trình viên module

Tính năng 004 (`specs/004-minimal-auth-rbac/`). Áp dụng nguyên tắc I (mã tài khoản chỉ từ phiên), VI (chặn
quyền ở API, mặc định từ chối) và VII (không tự viết mật mã, không lộ bí mật) của hiến pháp.

## Mặc định từ chối

`AccessGuard` chạy với **mọi** route của API. Mỗi handler phải có **đúng một** khai báo, đặt ở method
hoặc ở class (khai báo ở method ghi đè khai báo ở class):

| Khai báo                                                    | Ai gọi được                                                     | Ghi chú                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `@Public()`                                                 | mọi người                                                       | Có cookie khách hàng hợp lệ thì guard vẫn gắn `actor`, nhưng **không** gắn tài khoản |
| `@CustomerAccess(...quyền)`                                 | khách hàng đã đăng nhập, email đã xác nhận, có **đủ** các quyền | Chỉ đọc cookie `__Host-sid`                                                          |
| `@CustomerAccess({ allowUnverifiedEmail: true }, ...quyền)` | như trên nhưng cho cả email chưa xác nhận                       | Chỉ cho `/auth/me`, đăng xuất, sửa email…                                            |
| `@StaffAccess(...quyền)`                                    | nhân viên nội bộ, trong `STAFF_ALLOWED_CIDRS`                   | Chỉ đọc cookie `__Host-staff_sid`; yêu cầu thay đổi dữ liệu được ghi `staff.request` |

Kết quả của guard:

- Không có khai báo → 403 `ACCESS_NOT_DECLARED`. Ở `development`/`test`, API **không khởi động** khi có
  handler thiếu hoặc trùng khai báo. Kiểm thử `test/auth/access-declarations.spec.ts` chạy trong CI.
- Chưa đăng nhập, phiên hết hạn hoặc sai loại cookie → 401 `UNAUTHENTICATED`.
- Email chưa xác nhận → 403 `EMAIL_NOT_VERIFIED`. Thiếu quyền → 403 `FORBIDDEN`, kèm lời giải thích của
  quyền (`PERMISSION_DENIED_MESSAGES`). Cộng tác viên có thêm hành động `contact_owner`.
- Không tra được phiên (CSDL lỗi) → 503. Guard **không bao giờ** cho qua khi có lỗi.

```ts
import { Controller, Post } from '@nestjs/common';
import { CustomerAccess, currentAccountId, requireCustomer, tenantTx } from '../../core';

@Controller('posts')
export class PostsController {
  @Post(':id/approve')
  @CustomerAccess('post.approve')
  async approve() {
    const actor = requireCustomer(); // người gọi; accountId đã được guard gắn từ phiên
    return tenantTx((db) => /* … chỉ thấy dữ liệu của currentAccountId() … */ null);
  }
}
```

## Đọc người gọi trong nghiệp vụ

Nhập từ `core`: `currentActor()` (hoặc `null`), `requireCustomer()`, `requireStaff()` (ném lỗi lập trình
nếu sai loại – nghĩa là khai báo sai), `can(permission)` cho quyết định **bên trong** nghiệp vụ (vd ẩn
một trường). `can()` không thay khai báo: điểm cuối vẫn phải khai báo quyền.

Mã tài khoản đọc bằng `currentAccountId()` hoặc dùng thẳng `tenantTx`. **Không bao giờ** nhận
`accountId` từ path, query, body hay tiêu đề. Kiểm thử `test/auth/account-id-injection.e2e.spec.ts`
chứng minh guard bỏ qua mọi giá trị do người dùng gửi.

## Thêm quyền mới

0. Ghi quyền vào **danh mục quyền nghiệp vụ** trước: Đặc tả yêu cầu mục 3.1
   (`TaiLieuDacTa/Dac_ta_yeu_cau_App_AI_Content_MXH.md#dt-3-1-danh-muc-quyen`), kèm nguồn quyết định. Mỗi quyền
   có mốc neo `#pq-<mã, dấu chấm thành gạch ngang>` (vd `#pq-context-view`); chú thích trong mã, spec, plan
   trỏ thẳng vào mốc đó. Không đổi tên hay xóa mã đã dùng – quyền bỏ đi ghi "Ngừng dùng" kèm quyền thay thế.
   Quy ước đặt tên: `<module>.view` cho xem, `<module>.edit` cho sửa khi hai quyền khác vai trò (mẫu: hồ sơ
   kinh doanh, đặc tả 006); `<module>.manage` chỉ khi chỉ một vai trò được cả xem lẫn sửa.
1. Thêm **một dòng** vào `packages/shared/src/auth/permissions.ts` kèm chú thích truy vết FR và mốc neo. Đây là
   nguồn duy nhất trong mã – web dùng cùng bảng để ẩn/hiện nút (chỉ là trải nghiệm, API vẫn tự chặn).
2. Thêm lời giải thích vào `PERMISSION_DENIED_MESSAGES` (`apps/server/src/core/auth/permissions.ts`) –
   kiểu `Record<Permission, string>` bắt buộc đủ.
3. Cập nhật bảng mong đợi ở `test/auth/permissions.spec.ts`. Ma trận e2e
   (`test/auth/access-matrix.e2e.spec.ts`) tự sinh điểm cuối cho mỗi quyền.
4. Đổi quyền của vai trò có sẵn phải được review theo nguyên tắc VI.

Quyền của khách hàng (chủ hoặc cộng tác viên có) chỉ dùng được với `@CustomerAccess`; quyền nội bộ chỉ
với `@StaffAccess` – trộn lẫn sẽ ném lỗi ngay khi nạp mô-đun.

## Hàm hạn chế và quy tắc ranh giới

| Hàm                                                            | Ai được nhập                                                | Quy tắc                    |
| -------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------- |
| `bindAccountToRequest` (`core/context/bind-account.ts`)        | chỉ `core/auth/access.guard.ts`, `core/db`, `modules/queue` | `bind-account-restricted`  |
| `authTx` (`core/db/auth-tx.ts`) – giao dịch `app` không tenant | `core/auth/**`, `modules/account/internal/auth/**`          | `auth-tx-restricted`       |
| `runInAccountScope` (`core/auth/account-scope.ts`)             | `modules/account/internal/auth/**`                          | `account-scope-restricted` |
| `SessionCache` (`core/auth/session-cache.ts`)                  | `core/auth/**`, `modules/account/internal/auth/**`          | `account-scope-restricted` |

`authTx` chỉ dùng để gọi 4 hàm `SECURITY DEFINER` (xem `docs/database.md`), đọc/ghi bảng dùng chung
của xác thực và ghi `infra.audit_log`. Bộ gác truy vấn của 002 vẫn chặn bảng tenant bên trong `authTx`.
`runInAccountScope(accountId, fn)` chỉ được gọi với `accountId` lấy từ CSDL **sau khi** danh tính đã
được xác minh (mật khẩu đúng, mã phiên hoặc mã một lần hợp lệ).

## Phiên, cookie, chống giả mạo

- Cookie `HttpOnly; Secure; SameSite=Lax; Path=/`, tiền tố `__Host-`, không `Domain`. Web không bao giờ
  đọc được mã phiên. CSDL và bộ nhớ đệm chỉ giữ SHA-256 của mã.
- Bộ nhớ đệm phiên trong tiến trình sống ≤ 60 giây: thu hồi (đăng xuất, gỡ thành viên, khóa người dùng)
  có hiệu lực **ngay** trên bản API xử lý yêu cầu và ≤ 60 giây trên các bản khác (SC-005).
- Mọi `POST/PUT/PATCH/DELETE` (kể cả điểm cuối công khai) phải có `Origin` thuộc `WEB_ORIGINS` hoặc
  `Sec-Fetch-Site: same-origin`, nếu không → 403 `CSRF_REJECTED`.

## Nhật ký

Mọi dòng nhật ký có `actor_id`, `actor_kind`. Pino che `cookie`, `set-cookie`, `authorization`,
`password`, `currentPassword`, `newPassword`, `token`. Không ghi email, mật khẩu, mã phiên, mã một lần,
băm vào nhật ký hay `infra.audit_log.metadata` (chỉ `{ ip, ua_family, reason }`). Kiểm thử
`test/auth/auth-secrets-in-logs.e2e.spec.ts` và `pnpm check:secrets` chặn hồi quy.

## Đăng nhập Google / Facebook, cách đăng nhập, lời mời (009)

Mã ở `modules/account/internal/auth/` (thư mục `oauth/` cho vòng đăng nhập). Hợp đồng HTTP:
`specs/009-social-login-members/contracts/auth-http-api.md`.

**Vòng đăng nhập.** `POST /auth/oauth/{provider}/start` mở một dòng `account.oauth_flows` (bảng dùng
chung, chỉ qua `authTx`) và đặt cookie `__Host-oauth` (`HttpOnly; Secure; SameSite=Lax`, 30 phút). Nhà
cung cấp chuyển về `GET /auth/oauth/{provider}/callback`, điểm cuối này **luôn 303** về `/oauth/result`
không tham số; web đọc kết quả bằng `GET /auth/oauth/pending`. CSDL chỉ giữ SHA-256 của cookie, `state`
và mã trong thư. Giai đoạn (`oauth-flow.service.ts`, mọi chuyển đổi là cập nhật có điều kiện):

```text
started → signed_in | needs_signup | needs_email | needs_link_confirm | completed | failed
needs_signup → completed          needs_email → awaiting_email
needs_link_confirm → completed | awaiting_email          awaiting_email → completed
(mọi giai đoạn chưa kết thúc) → failed
```

**Không tự gộp tài khoản.** Email của nhà cung cấp trùng người dùng đã có → `needs_link_confirm`: phải
nhập đúng mật khẩu (chỉ khi người đó có mật khẩu và email đã xác minh) hoặc mở liên kết gửi tới email
đó. Nhánh email **tự nhập** trả lời giống hệt nhau dù email đã có người dùng hay chưa.

**Độ tin của email.** Google: đúng giá trị `email_verified` của ID token. Facebook: có trả email = đã
xác minh, không trả = chưa. Quy tắc Facebook nằm ở **một dòng** trong
`oauth/arctic.providers.ts` (`emailVerified: hasEmail`) – đổi ở đó nếu giả định của research R3 sai.

**Bản giả lập.** `OAUTH_DRIVER=fake` (mặc định ở development/test; staging/production từ chối khởi
động). Trang `GET /api/v1/dev/oauth/fake/authorize` cho chọn kịch bản `google_verified`,
`google_unverified`, `facebook_with_email`, `facebook_no_email`, `cancel`, `provider_down`; thêm
`&email=…&name=…&sub=…` để dựng tình huống. Kiểm thử dùng `oauthLogin(...)` trong
`test/auth/helpers/app.ts`. Ở staging/production chưa đặt `OAUTH_DRIVER` thì đăng nhập Google/Facebook ở
trạng thái "chưa bật": `start` trả 503 `PROVIDER_UNAVAILABLE`, đăng nhập bằng email vẫn chạy.

**Tài khoản chờ và `allowDetached`.** Cộng tác viên bị gỡ được chuyển sang một tài khoản
`status = 'unclaimed'` của riêng họ (`CustomerActor.detached = true`). Mặc định mọi điểm cuối trả 403
`NO_ACCOUNT` cho họ. Điểm cuối **cá nhân** (không đụng dữ liệu kinh doanh) mở bằng:

```ts
@CustomerAccess({ allowDetached: true })                              // không kèm quyền
@CustomerAccess({ allowDetached: true, allowUnverifiedEmail: true })
```

`allowDetached` kèm quyền là lỗi khi khởi động. Điểm cuối nghiệp vụ mới **không** thêm cờ này.

**Xác nhận lại danh tính.** Liên kết, gỡ cách đăng nhập và tạo mật khẩu đòi phiên "mới xác nhận":
`coalesce(sessions.reauthenticated_at, created_at)` trong `REAUTH_WINDOW_MINUTES` (10) phút, đọc dòng
phiên trong giao dịch. Chưa đủ → 403 `REAUTH_REQUIRED` (hành động `reauth`). Phiên cấp do xoay vòng
(`claim`, `accept-existing`) mang mốc của phiên cũ.

**Ghế.** Ghế vai trò `active` ∪ ghế lời mời `pending` ⊆ {1, 2}. Mọi thao tác đổi ghế lấy
`pg_advisory_xact_lock(hashtextextended('account.seats:' || account_id, 0))` trước khi đọc ghế
(`lockSeats` trong `invitations.service.ts`, cùng biểu thức trong migration `0016`).

**Việc nền** (`modules/account/jobs.ts`): `account.mail_notice` (`notify`, tenant – thư không mã, dữ
liệu việc chỉ có mã tham chiếu), `account.auth_housekeeping` (mỗi 10 phút), `account.detached_users`
(mỗi giờ – báo trước 7 ngày rồi xóa người ở tài khoản chờ sau 90 ngày).

**Thông báo của Meta.** `POST /auth/facebook/deauthorize` và `POST /auth/facebook/data-deletion` là máy
gọi máy, được miễn kiểm tra nguồn gửi bằng danh sách **cố định** `META_CALLBACK_PATHS` trong
`core/auth/origin-check.middleware.ts`; tính xác thực dựa vào chữ ký `signed_request`
(`parseSignedRequest`). Không thêm đường dẫn nào khác vào danh sách này.

**Biến cấu hình**: `OAUTH_DRIVER`, `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_APP_ID/SECRET`,
`FACEBOOK_GRAPH_VERSION`, `OAUTH_FLOW_TTL_MINUTES`, `LINK_CONFIRM_TTL_MINUTES`, `REAUTH_WINDOW_MINUTES`,
`INVITE_TTL_DAYS`, `INVITE_MAX_PER_ACCOUNT_PER_DAY`, `DETACHED_RETENTION_DAYS`, `DETACHED_NOTICE_DAYS`
(`apps/server/.env.example`).

**Nhật ký.** Nhật ký yêu cầu của `/api/v1/auth/oauth/*` và `/api/v1/dev/oauth/*` không ghi chuỗi truy
vấn; `signed_request`, `code_verifier`, `invitationToken` luôn bị che. `code`/`state` chỉ bị che ở tham
số truy vấn (tên quá chung – che ở mọi nơi sẽ làm mất mã lỗi trong nhật ký).

## Kiểm thử

- Đơn vị: `pnpm --filter @app/server test` (guard với `SessionResolver` giả, quyền, cookie, mật khẩu…).
- e2e cần CSDL thật: `pnpm test:db` (đặt `TEST_DATABASE_ADMIN_URL`) chạy `test/auth/**/*.e2e.spec.ts`
  với `test/auth/helpers/app.ts` (ApiAppModule thật, thư trong bộ nhớ, mỗi agent một địa chỉ mạng giả).
- Dữ liệu mẫu cho máy dev: `pnpm dev:seed-auth`. Nhân viên nội bộ: `pnpm staff create|disable|reset-password|list`.
