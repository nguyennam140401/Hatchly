# Hợp đồng: giao diện nội bộ – lớp chặn quyền, module `account`, việc nền, vận hành

Đây là hợp đồng hành vi; chữ ký có thể chỉnh nhỏ ở bước tasks. Bổ sung cho
[authz-api của 004](../../004-minimal-auth-rbac/contracts/authz-api.md) và
[auth-ops của 004](../../004-minimal-auth-rbac/contracts/auth-ops.md).

## 1. Lõi `core/auth`

```ts
type CustomerActor = {
  kind: 'user'; userId: string; accountId: string; role: CustomerRole;
  emailVerified: boolean; sessionId: string;
  detached: boolean;            // MỚI: tài khoản của phiên đang 'unclaimed'
};

@CustomerAccess({ allowDetached: true })                          // MỚI
@CustomerAccess({ allowDetached: true, allowUnverifiedEmail: true })
```

Hành vi bổ sung của `AccessGuard` (kiểm **sau** khi gắn người gọi, **trước** kiểm email và quyền):

| Tình huống | Kết quả |
|---|---|
| `actor.detached` và khai báo không có `allowDetached` | 403 `NO_ACCOUNT` + nhật ký `auth.denied` (`reason: detached`) |
| `actor.detached` và khai báo có `allowDetached` **kèm quyền** | lỗi khi khởi động (khai báo vô nghĩa: người ở tài khoản chờ không có quyền nào) |
| `can(permission)` khi `detached` | luôn `false` |

- `SessionResolver.resolveCustomer` trả thêm `detached` (từ `auth_resolve_session_v2`).
- Ma trận truy cập (`access-matrix.e2e.spec.ts`) thêm cột "người ở tài khoản chờ": mọi điểm cuối không
  nằm trong danh sách `+detached` của [auth-http-api](auth-http-api.md) phải trả 403 `NO_ACCOUNT`.
- Kiểm tra nguồn gửi (CSRF): thêm danh sách miễn **cố định trong mã** gồm đúng hai đường dẫn
  `/api/v1/auth/facebook/deauthorize` và `/api/v1/auth/facebook/data-deletion`.

```ts
// core/auth – cổng đảo phụ thuộc, module context cung cấp (research R17)
export const ACCOUNT_LABEL_RESOLVER = Symbol('ACCOUNT_LABEL_RESOLVER');
export interface AccountLabelResolver {
  /** Tên cửa hàng của tài khoản trong ngữ cảnh; null nếu chưa có hồ sơ. Chạy trong tenantTx của người gọi. */
  currentAccountLabel(): Promise<string | null>;
}
```

Thiếu nhà cung cấp → `account` dùng "tài khoản của {tên người mời}"; API vẫn khởi động.

## 2. Giao diện công khai của module `account` (`AccountPublicApi`)

| Thành phần | Thay đổi |
|---|---|
| `describeMembers(userIds)` | Trả thêm người trong `former_members` của tài khoản trong ngữ cảnh với `status: 'removed'` và tên lúc bị gỡ. Hợp đồng với 006 không đổi. |
| `listActiveMembers()` | Không đổi (người đã gỡ không còn trong tenant). |
| `removeMember(...)` | Đi qua cùng đường với `DELETE /members/{userId}` (`member_detach`); vẫn chỉ dành cho kiểm thử/dữ liệu mẫu khi gọi từ module khác. |
| `addMember(...)` | Giữ cho kiểm thử/dữ liệu mẫu; phải lấy khóa ghế `account.seats:{account_id}` và tránh ghế của lời mời `pending`. |

Không thêm thao tác công khai nào cho module khác. Module khác **không** được tạo lời mời hay liên kết
cách đăng nhập.

## 3. Nhà cung cấp đăng nhập (nội bộ `modules/account/internal/auth/oauth/`)

```ts
interface IdentityProvider {
  readonly name: 'google' | 'facebook';
  /** Địa chỉ chuyển sang nhà cung cấp; `codeVerifier` chỉ dùng với Google. */
  authorizationUrl(input: { state: string; codeVerifier: string | null }): URL;
  /** Đổi mã lấy hồ sơ. KHÔNG trả mã quyền ra ngoài; ném ProviderError phân loại được. */
  exchange(input: { code: string; codeVerifier: string | null }): Promise<ProviderProfile>;
}
type ProviderProfile = {
  provider: 'google' | 'facebook'; subject: string;
  email: string | null; emailVerified: boolean; displayName: string | null;
};
type ProviderError = { kind: 'cancelled' | 'invalid_grant' | 'unavailable' | 'malformed' };
```

- Bản `arctic`: Google `emailVerified` theo ID token; Facebook `emailVerified = true` khi có trả email,
  `false` khi không (research R3 – đây là chỗ duy nhất quyết định độ tin của email Facebook).
  Hết thời gian chờ gọi nhà cung cấp: 10 giây → `unavailable`.
- Bản `fake`: hồ sơ theo kịch bản (mục 6).
- Kiểm thử hợp đồng chung chạy trên cả hai bản (bản thật chỉ khi có biến môi trường, như 005).

## 4. Việc nền (`modules/account/jobs.ts`)

| Loại việc | Hàng chờ · phạm vi | Dữ liệu | Hành vi |
|---|---|---|---|
| `account.mail_notice` | `notify` · `tenant` | `{ template, userId, subjectUserId?, provider? }` | Tra người nhận `userId` trong tenant; không thấy hoặc bị khóa → bỏ qua (thành công). Gửi bằng `Mailer.deliver`; lỗi tạm thời → thử lại theo hàng chờ. Khóa chống trùng do nơi tạo đặt (vd `account.notice:deletion:{userId}:{detached_at}`). |
| `account.detached_users` | `scheduled` · `system`, mỗi giờ | `{}` | Research R18: báo trước rồi xóa; xử lý **mọi** người đến hạn, mỗi lần tối đa 200. |
| `account.auth_housekeeping` | `scheduled` · `system`, mỗi 10 phút | `{}` | `auth_housekeeping()` (hết hạn lời mời + kiểm toán `account.invitation.expired` cho từng lời mời vừa hết hạn); xóa `oauth_flows` đã kết thúc hoặc quá hạn > 24 giờ; xóa `meta_deletion_requests` > 12 tháng. |

`template` ∈ `identity_added` | `identity_removed` | `identity_removed_by_provider` |
`identity_link_blocked` | `invite_accepted` | `detached_deletion_notice`. Dữ liệu việc không có email, tên, mã hay liên kết.

Chạy lại hai lần cho cùng kết quả: báo trước dựa trên cập nhật có điều kiện + khóa chống trùng; xóa dựa
trên điều kiện kiểm trong hàm; hết hạn là `UPDATE … WHERE status = 'pending'`.

## 5. Thư

| Mẫu | Người nhận | Có mã | Cách gửi |
|---|---|---|---|
| `inviteMember` | email được mời | có (`/join#token=…`) | trong tiến trình sau khi xác nhận |
| `confirmIdentityLink` | email của người dùng đã có | có (`/oauth/confirm#token=…`) | như trên |
| `completeSignup` | email người dùng nhập | có (`/oauth/confirm#token=…`) | như trên |
| `resetPassword` (sẵn có, thêm lời cho "tạo mật khẩu") | người dùng | có | như trên |
| `memberRemoved` | người bị gỡ | không | trong tiến trình sau khi xác nhận (research R16) |
| `identityAdded`, `identityRemoved`, `identityRemovedByProvider` | người dùng | không | việc `account.mail_notice` |
| `identityLinkBlocked` | người dùng đã có (đã gắn một tài khoản khác của cùng nhà cung cấp) | không | việc `account.mail_notice`; chỉ ở nhánh email tự nhập, tính vào ngưỡng `mail_link_confirm` |
| `inviteAccepted` | chủ tài khoản | không | việc `account.mail_notice` |
| `detachedDeletionNotice` | người ở tài khoản chờ | không | việc `account.mail_notice` |

Mọi thư: tiếng Việt đời thường; mã một lần nằm ở `#fragment`; không có mật khẩu, mã của nhà cung cấp hay
số tiền. `memberRemoved` nêu tên cửa hàng, không nêu lý do. `identityRemovedByProvider` hướng dẫn vào lại
bằng "Quên mật khẩu".

## 6. Cấu hình và vận hành

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `OAUTH_DRIVER` | `fake` (dev/test) | `real` \| `fake`; staging/production từ chối `fake` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | bắt buộc khi `real`; bí mật |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | — | bắt buộc khi `real`; bí mật; cũng dùng kiểm `signed_request` |
| `FACEBOOK_GRAPH_VERSION` | chốt khi cài | |
| `OAUTH_FLOW_TTL_MINUTES` | 10 | |
| `LINK_CONFIRM_TTL_MINUTES` | 30 | |
| `REAUTH_WINDOW_MINUTES` | 10 | |
| `INVITE_TTL_DAYS` | 7 | |
| `INVITE_MAX_PER_ACCOUNT_PER_DAY` | 10 | |
| `DETACHED_RETENTION_DAYS` / `DETACHED_NOTICE_DAYS` | 90 / 7 | |

- Địa chỉ quay về đăng ký với nhà cung cấp: `{WEB_BASE_URL}/api/v1/auth/oauth/{provider}/callback`.
  Địa chỉ khai báo với Meta: hai điểm cuối mục 6 của [auth-http-api](auth-http-api.md).
- Bí mật mới đi qua kho bí mật của môi trường (007); thêm vào `.env.example` không có giá trị thật.
- Nhật ký: không ghi chuỗi truy vấn của `/auth/oauth/*`; pino che `code`, `state`, `signed_request`,
  `code_verifier`, `invitationToken`. Bộ quét bí mật (`tooling/scan-secrets.mjs`) thêm các mẫu này.
- Bản giả lập (chỉ `OAUTH_DRIVER=fake`): `GET /api/v1/dev/oauth/fake/authorize?scenario=…` với kịch bản
  `google_verified`, `google_unverified`, `facebook_with_email`, `facebook_no_email`, `cancel`,
  `provider_down`; tham số `sub`, `email`, `name` tùy chọn để kiểm thử dựng tình huống.
- `pnpm dev:seed-auth`: thêm một cộng tác viên, một lời mời đang chờ và một người ở tài khoản chờ.
- Chỉ số: `auth_oauth_total{provider, outcome}`, `account_invitations_total{event}`,
  `account_detached_purged_total`; histogram `auth_oauth_callback_duration_seconds{provider}` (SC-002) và
  `account_mail_send_duration_seconds{template}` (SC-004); cảnh báo khi tỷ lệ `outcome=provider_error` của
  một nhà cung cấp > 20% trong 15 phút (`ops/alerts/auth.rules.yml`).
