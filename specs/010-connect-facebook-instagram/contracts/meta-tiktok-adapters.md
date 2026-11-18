# Hợp đồng – bộ chuyển đổi Meta (Facebook Page, Instagram) và TikTok: phần kết nối

Bổ sung cho 005 (`PlatformAdapter`) và 013 (`contracts/platform-adapters.md`, phần `submit/checkStatus/reconcile`). 010 **không đổi** phần đăng của 013.
Mọi số liệu nền tảng dưới đây là **giả định hiện hành, đánh dấu [POC-2]**: đổi bằng cấu hình, chốt khi nộp App Review/POC; kiểm thử dùng máy chủ giả.
Gọi bằng `fetch` + `AbortSignal`: Meta dùng `META_GRAPH_TIMEOUT_MS` (đã có, mặc định 25 giây); các lời gọi **tương tác** của 010 (kiểm tra lại, gọi lại OAuth) đặt trần riêng 10 giây
(`CHANNEL_INTERACTIVE_TIMEOUT_MS`, mới, nhỏ hơn giá trị trên) để người dùng không chờ lâu; TikTok dùng `TIKTOK_TIMEOUT_MS` (mới, mặc định 10 giây). Phiên bản API cố định bằng cấu hình.
**Không** ghi `code`, mã quyền, `client_secret` vào URL log: URL đã che tham số nhạy cảm (`access_token`, `code`, `client_secret`, `fb_exchange_token` → `[redacted]`).

## 1. Cấu hình (biến môi trường, đọc ở `config.schema.ts`; chỉ API + Worker cần)

| Biến | Ý nghĩa |
|---|---|
| `PLATFORM_ADAPTER_MODE` (đã có, 013) | `real` ⇒ đăng ký bộ chuyển đổi thật; `fake` ⇒ bản giả (dev/test) |
| `CHANNEL_CONNECT_REDIRECT_BASE` | gốc URL công khai của API để dựng `redirect_uri` = `<base>/api/v1/channels/callback/<channelType>` (phải trùng cấu hình ở Meta/TikTok) |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` (đã có, 009) | cùng ứng dụng Meta với đăng nhập (một lần App Review); **bí mật** – chỉ qua `Secret` K8s |
| `META_GRAPH_VERSION`, `META_GRAPH_BASE_URL`, `META_GRAPH_TIMEOUT_MS` (đã có, 013) | phiên bản cố định + gốc (đổi sang máy chủ giả khi kiểm thử) + thời gian chờ |
| `CHANNEL_SCOPE_GROUPS` (mặc định `publish,analytics,ads`) | nhóm quyền được xin (R1a, FR-002/FR-043); `ads` chỉ áp cho Meta (TikTok bỏ qua); `trends` **không** hợp lệ (cấu hình sai → API không khởi động); nộp App Review chỉ với `publish` = đổi biến này, không sửa mã |
| `CHANNEL_SCOPES_FACEBOOK_PAGE`, `CHANNEL_SCOPES_INSTAGRAM`, `CHANNEL_SCOPES_TIKTOK` | bảng nhóm → quyền cụ thể theo từng nền tảng (R1, R1a) |
| `META_TOKEN_REFRESH_ENABLED` | bật làm mới Meta (R2) |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_BASE_URL`, `TIKTOK_TIMEOUT_MS`, `CHANNEL_SCOPES_TIKTOK`, `TIKTOK_APP_STATUS` (`sandbox`\|`in_review`\|`approved`) | TikTok; `TIKTOK_APP_STATUS != approved` ⇒ UI ghi "đang thử nghiệm" |
| `CHANNEL_INTERACTIVE_TIMEOUT_MS` | trần 10 giây cho lời gọi do người dùng đang chờ |
| `CREDENTIAL_VAULT_DRIVER` (`kms`\|`env-master-key`\|`fake`), `KMS_KEY_ID`, `CREDENTIAL_MASTER_KEY_B64` | R10; production bắt buộc `kms` |

`assert-no-fakes` (mở rộng): production từ chối `fake` ở vault/adapter, từ chối `env-master-key`; staging cho `env-master-key` khi `STAGING_ALLOW_ENV_MASTER_KEY=true`.
Thiếu biến bắt buộc khi `PLATFORM_ADAPTER_MODE=real` → API không khởi động (thông báo chỉ nêu **tên biến**, như `resolveOAuthConfig` của 009). Worker không đòi `*_SECRET` của Meta/TikTok ở thao tác không cần gọi nền tảng.

## 2. Facebook Page

| Thao tác | Hành vi |
|---|---|
| `authorizeUrl(state, redirectUri)` | `…/dialog/oauth` với `client_id`, `redirect_uri`, `state`, `response_type=code`, `scope` (R1); kết nối lại dùng `auth_type=rerequest` khi thiếu quyền |
| `exchangeCallback({code,error})` | `error=access_denied` ⇒ `CONNECT_CANCELLED`; đổi `code` → mã ngắn hạn → mã dài hạn; `GET /me/accounts?fields=id,name,picture{url},access_token,tasks,instagram_business_account{id,username}` (phân trang, tối đa 100 Page); mỗi Page → `ConnectionCandidate` (`accessToken` = mã Page, `refreshToken` = mã người dùng dài hạn, `avatarUrl`, `grantedScopes` từ `debug_token`/`/me/permissions`) |
| `checkAccount` | (a) `debug_token` ⇒ `is_valid` + đủ quyền bắt buộc (`CHANNEL_SCOPES_FACEBOOK_PAGE`); (b) vai trò: `tasks` chứa `CREATE_CONTENT` (hoặc tương đương theo quy tắc nền tảng) → không đủ ⇒ `ineligible` + `ROLE_TOO_LOW`; (c) Page còn tồn tại; (d) `quotaRemaining = null` (Facebook không báo) |
| `expiryOf` | `debug_token`: bỏ mốc `0`; không còn mốc ⇒ `none`; còn mốc ⇒ `min(expires_at, data_access_expires_at)` kèm `kind` tương ứng |
| `refreshToken` | đổi lại mã người dùng dài hạn (`fb_exchange_token`) rồi lấy lại mã Page; ghi mã mới (`token_issued_at` mới); thành công ⇒ `refreshed` với hạn đo lại; `capabilities.tokenRefresh` theo `META_TOKEN_REFRESH_ENABLED` |
| `revoke` | `DELETE /{user-id}/permissions` bằng mã người dùng dài hạn (nếu còn) ⇒ `done`; lỗi/không có ⇒ `failed` (hệ thống vẫn xóa mã phía mình – FR-017). **Cẩn trọng:** thu hồi *toàn bộ* quyền của người dùng với ứng dụng ảnh hưởng các Page khác cùng người đó ⇒ chỉ thu hồi khi đây là **kết nối cuối cùng dùng chung mã người dùng đó**; ngược lại bỏ qua (`unsupported`) và hướng dẫn gỡ trong cài đặt Facebook. Điều kiện kiểm bằng `refresh_ciphertext` giống nhau (so băm, không giải mã) |

## 3. Instagram (chuyên nghiệp, qua Page)

| Thao tác | Hành vi |
|---|---|
| `authorizeUrl` | như Facebook với `CHANNEL_SCOPES_INSTAGRAM`; nếu tài khoản đã có kết nối Facebook Page với đủ quyền → `include_granted_scopes`/không chuyển màn hình khi mã người dùng dài hạn của lần trước còn hiệu lực (US2-5) |
| `exchangeCallback` | như Facebook nhưng ứng viên = Page **có** `instagram_business_account`: `externalId = ig_user_id`, `displayName = @username`, `sourceExternalId = mã Page`, `accessToken = mã Page`; Page **không** có IG ⇒ không thành ứng viên, ghi nhận để hiện hướng dẫn "liên kết Instagram với Page" (`PAGE_NOT_LINKED`) |
| `checkAccount` | `GET /{ig_user_id}?fields=username,account_type` (hoặc tương đương): `BUSINESS`/`MEDIA_CREATOR` ⇒ eligible (`accountType = instagram_business|instagram_creator`); `PERSONAL`/thiếu ⇒ `ineligible` + `NOT_PROFESSIONAL` + hướng dẫn "chuyển sang tài khoản chuyên nghiệp và liên kết với Page" + nút "Kiểm tra lại"; `quotaRemaining` từ endpoint hạn mức đăng 24 giờ (013: `reportsQuota=true`) |
| `expiryOf`, `refreshToken` | như Facebook Page (dùng mã Page của Page nguồn) |
| `revoke` | **không** thu hồi quyền người dùng (dùng chung với Page); `unsupported` ⇒ hệ thống chỉ xóa mã phía mình |
| Phụ thuộc Page nguồn | `source_connection_id` = kết nối Facebook Page cùng `sourceExternalId` **nếu đã có trong tài khoản**; chưa có Page đó ⇒ `source_connection_id = NULL` (Instagram độc lập – US2-6). Khi người dùng sau này kết nối Page đó, hệ thống **liên kết** (cập nhật `source_connection_id`) ở lần `confirm` Page (cùng giao dịch) |

## 4. TikTok (sau công tắc – FR-036…FR-041)

Mọi thao tác kiểm `isFeatureEnabled('channel.tiktok')` **trước** khi gọi `TiktokClient`; tắt/không đọc được ⇒ `FEATURE_NOT_ENABLED`, **không** có lời gọi mạng.

| Thao tác | Hành vi **[POC-2 / TikTok review]** |
|---|---|
| `authorizeUrl` | `https://www.tiktok.com/v2/auth/authorize/` với `client_key`, `scope`, `redirect_uri`, `state`, `response_type=code` |
| `exchangeCallback` | `POST /v2/oauth/token/` (`authorization_code`) ⇒ `access_token`, `refresh_token`, `expires_in`, `refresh_expires_in`, `open_id`, `scope`; lấy `display_name`/`avatar_url` bằng `user/info`; **một** ứng viên (`open_id`) |
| `checkAccount` | quyền đăng video đã cấp (`video.publish`/`video.upload`); `creator_info/query` ⇒ `max_video_post_duration_sec` (đưa vào `conditions`) ; thiếu quyền ⇒ `ineligible` + `SCOPE_MISSING` |
| `expiryOf` | `{ kind: 'token', expiresAt: refresh_token hết hạn }` |
| `refreshToken` | `POST /v2/oauth/token/` (`refresh_token`) ⇒ cặp mã mới (cả hai mã mới đều được ghi) |
| `revoke` | `POST /v2/oauth/revoke/` ⇒ `done`/`failed` |
| `mediaRules` | chỉ video (`image=null`); `maxDurationSec` mặc định theo cấu hình (từ `creator_info` khi biết) |
| `submit` / `checkStatus` / `reconcile` | **chưa hiện thực đăng thật** (R9): `submit` ⇒ `failed`, loại `user_action`, `rawCode = TIKTOK:POSTING_NOT_AVAILABLE`, remedy `contact_support`; `checkStatus` ⇒ `failed` tương tự; `reconcile` ⇒ `unsupported/capability`. **Không bao giờ `transient`** |
| `capabilities` | `reconcile:false, asyncProcessing:true, tokenRefresh:true, reportsQuota:false, maxReconcileWindowHours:null` |

## 5. Bảng lỗi kết nối/kiểm tra (mặc định trong mã, ghi đè bằng `publishing.error_mappings` qua cổng ngược)

`rawCode` theo 013 (`FB:190`, `IG:…`, `TT:…`, `HTTP:…`, `NET:…`). Quy tắc bất biến: **mã lạ ⇒ `unknown`**; lỗi mạng/5xx khi *kiểm tra* ⇒ `transient` (kiểm tra **không** gây tác dụng phụ nên thử lại an toàn – khác `submit`).

| Tình huống | Loại | `reasonCode` | Thông điệp (rút gọn) | Hành động |
|---|---|---|---|---|
| Người dùng hủy / từ chối quyền bắt buộc | `user_action` | `CONNECT_CANCELLED` / `SCOPE_MISSING` | Bạn chưa hoàn tất kết nối… / Còn thiếu quyền đăng bài lên Page | Thử lại · Cấp quyền lại |
| Mã hết hạn/thu hồi (FB 190/102; TikTok `access_token_invalid`) | `user_action` | `TOKEN_EXPIRED` / `TOKEN_REVOKED` | Facebook báo quyền đã bị thu hồi / đã hết hạn | Kết nối lại |
| Vai trò thấp trên Page | `user_action` | `ROLE_TOO_LOW` | Bạn cần là quản trị viên hoặc biên tập viên của Page này | Nhờ quản trị viên Page cấp lại vai trò |
| Page bị xóa/khóa | `user_action` | `PAGE_UNAVAILABLE` | Page không còn truy cập được | Chọn Page khác · Ngắt kết nối |
| IG không chuyên nghiệp | `user_action` | `NOT_PROFESSIONAL` | Tài khoản Instagram cần chuyển sang tài khoản chuyên nghiệp và liên kết với Page | Xem hướng dẫn · Kiểm tra lại |
| Page chưa liên kết IG | `user_action` | `PAGE_NOT_LINKED` | Page chưa liên kết với tài khoản Instagram nào | Xem hướng dẫn · Kiểm tra lại |
| Giới hạn tốc độ | `transient` | — | Nền tảng đang hạn chế tạm thời | Thử lại sau |
| Nền tảng không phản hồi khi kiểm tra | `transient` | — | Chưa kiểm tra được, thử lại sau (**không** đổi trạng thái kênh – FR-012) | Thử lại sau |
| Ứng dụng chưa được duyệt (chỉ người thử nghiệm) | `user_action` | `APP_NOT_APPROVED` | Tính năng kết nối đang được chuẩn bị | Liên hệ hỗ trợ |
| Mã lạ | `unknown` | `UNKNOWN` | Có lỗi chưa rõ nguyên nhân | Thử lại sau · Liên hệ hỗ trợ ("Chi tiết cho hỗ trợ" có mã gốc) |

## 6. Kiểm thử hợp đồng (CI – bắt buộc cho mỗi bộ chuyển đổi, Hiến pháp "Quy trình")

Dùng chung `adapter-contract.spec.ts` (013) + bổ sung ca kết nối:

1. `authorizeUrl` chứa đủ tham số, **không** chứa `client_secret`/mã quyền; `state` đi nguyên văn.
2. `exchangeCallback`: hủy ⇒ `CONNECT_CANCELLED`; 2 Page ⇒ 2 ứng viên; Page không IG ⇒ không có ứng viên IG; phân trang > 1 trang.
3. `checkAccount`: đủ quyền ⇒ eligible; thiếu quyền; vai trò thấp; IG cá nhân; Page bị xóa — mỗi ca đúng một `reasonCode` + ≥ 1 remedy.
4. `expiryOf`: `none` / `token` / `data_access` đúng; không bịa ngày.
5. `refreshToken`: thành công ⇒ hạn mới; mã bị thu hồi ⇒ `failed` `user_action`; lỗi mạng ⇒ `failed` `transient`.
6. `revoke`: không ném; `failed` khi nền tảng lỗi.
7. **Bí mật**: quét URL gọi ra, log, `ClassifiedError`, thông điệp lỗi bằng mẫu `EAA…`, `act.…`, `fake_tok_*`, `client_secret` ⇒ không có.
8. TikTok: công tắc tắt ⇒ **0 lời gọi mạng** (đếm trên máy chủ giả) ở mọi thao tác; `submit` luôn `user_action`.
