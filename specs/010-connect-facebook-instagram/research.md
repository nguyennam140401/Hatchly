# Research (Phase 0) – 010 Kết nối kênh Facebook Page + Instagram + TikTok

Mỗi mục: **Quyết định** · **Lý do** · **Phương án đã xét**. Mục nào phụ thuộc dữ kiện của nền tảng chưa kiểm chứng được đánh dấu
**[POC-2]** (kiểm bằng POC hoặc App Review; thiết kế để *đổi bằng cấu hình*, không phải sửa luồng). Không còn `NEEDS CLARIFICATION`
nào trong Technical Context.

## R1 – Luồng cấp quyền Meta (Facebook Page + Instagram)

**Quyết định.** OAuth 2.0 *authorization code* của Facebook Login, gọi bằng `fetch` (không SDK), **tách riêng** khỏi đăng nhập 009:

1. `authorizeUrl(state, redirectUri)` → `https://www.facebook.com/<version>/dialog/oauth?client_id&redirect_uri&state&scope&response_type=code`
   (`<version>` cố định bằng cấu hình `META_GRAPH_VERSION`, dùng chung với 013).
2. `exchangeCallback({code})` → đổi `code` lấy **mã người dùng ngắn hạn**, đổi tiếp lấy **mã người dùng dài hạn** (`fb_exchange_token`),
   rồi `GET /me/accounts` (có phân trang) lấy danh sách Page kèm **mã Page** riêng và `instagram_business_account` của từng Page.
3. Ứng viên **Facebook Page** = mỗi Page người dùng có quyền đăng (`tasks` chứa `CREATE_CONTENT`/vai trò quản trị/biên tập); lưu *mã Page*.
   Ứng viên **Instagram** = mỗi Page có `instagram_business_account`; lưu *mã Page nguồn* (dùng cho Graph Instagram) + `ig_user_id` + `username`.
4. Mã người dùng dài hạn được giữ **mã hóa** làm "mã làm mới" (`refresh_ciphertext`) để gọi `debug_token`/gia hạn; bị xóa cùng kết nối.

Quyền xin (cấu hình `CHANNEL_SCOPES_FACEBOOK_PAGE`, `CHANNEL_SCOPES_INSTAGRAM`; mặc định theo hiểu biết hiện tại, **[POC-2] chốt ở App Review**):

| Kênh | Quyền mặc định | Dùng để |
|---|---|---|
| Facebook Page | `pages_show_list`, `pages_manage_posts`, `pages_read_engagement` | liệt kê Page, đăng bài, đọc lại bài (đối soát/trạng thái) |
| Instagram | `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish` | liệt kê Page → IG liên kết, kiểm tra loại tài khoản, đăng, đọc trạng thái container |

### R1a – Nhóm quyền theo nghiệp vụ (cập nhật 2026-11-17 theo yêu cầu của PO)

PO cần: quản lý bài/video (thêm, sửa, xem, xóa), thống kê hiệu quả, quản lý quảng cáo (không tạo quảng cáo/tăng ngân sách; nếu tạo chỉ ở dạng nháp chờ duyệt), lấy từ khóa xu hướng để cải thiện gợi ý.
Thiết kế: cấu hình quyền chia **nhóm**, mỗi nhóm bật/tắt độc lập bằng cấu hình (`CHANNEL_SCOPE_GROUPS`), xin thêm bằng `auth_type=rerequest` khi người dùng đã kết nối (không bắt kết nối lại từ đầu). Dữ kiện nền tảng bên dưới là **hiểu biết hiện tại, [POC-2] cần kiểm khi nộp App Review**.

| Nhóm | Nội dung | Quyền nền tảng (dự kiến) | Trong 010? |
|---|---|---|---|
| `publish` | đăng, **sửa, xem, xóa** bài của chính kênh | Facebook: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement` · Instagram: `instagram_basic`, `instagram_content_publish` (+ hai quyền Page) · TikTok: `user.info.basic`, `video.publish`/`video.upload`, `video.list` | **Có** (mặc định bật). Lưu ý: Instagram API chính thức không cho sửa nội dung bài đã đăng và TikTok API không có sửa/xóa video – "sửa/xóa" chỉ khả thi ở Facebook; phần còn lại thuộc tính năng quản lý bài sau |
| `analytics` | thống kê hiệu quả bài/kênh (chỉ số tổng hợp của chính kênh) | Facebook: `read_insights`; Instagram: `instagram_manage_insights`; TikTok: `user.info.stats`, `video.list` | **Có, nhưng chỉ sau khi FR-002 được sửa** (mặc định tắt trong cấu hình cho đến lúc đó) |
| `ads` | xem/quản lý quảng cáo, **không** tạo/tăng ngân sách; tạo chỉ ở dạng nháp chờ duyệt | `ads_read`, `ads_management`, `business_management` (**chỉ Meta**) | **Có xin quyền** (PO chọn phương án C, 2026-11-18, FR-043) nhưng **không gọi API quảng cáo**; cấu hình tách được để nộp App Review chỉ với nhóm `publish` nếu Meta chặn |
| `trends` | từ khóa xu hướng gợi ý bài | không có quyền nền tảng tương ứng cho "xu hướng chung" | **Không** – dùng RSS + Brave Search (module `trends`) |

> **Cập nhật 2026-11-18:** `/speckit-clarify` chốt phương án C: 010 xin `publish` + `analytics` + `ads` (Meta). Các lý do dưới đây vẫn đúng và trở thành **rủi ro chấp nhận**, không còn là lý do hoãn: (1) Meta có thể từ chối quyền chưa dùng/yêu cầu Business Verification + Advanced Access; (2) ép "chỉ nháp, chờ duyệt" do tính năng quảng cáo làm sau; (3) cần ADR + cập nhật hồ sơ Q-D3/C6. `CHANNEL_SCOPE_GROUPS` mặc định `publish,analytics,ads` ở môi trường mà App Review cho phép; `trends` vẫn không hợp lệ.

Lý do tách và hoãn `ads`/`trends`:
- **Ngoài phạm vi giai đoạn 1** (Hiến pháp IX; spec 010 và đặc tả yêu cầu không có FR về quảng cáo) và **cần đổi FR-002 + Hiến pháp VII** (quyền tối thiểu). Thay đổi này do PO duyệt (Governance) → cần `/speckit-clarify` + ADR, không nên lẻn vào kế hoạch.
- Quyền quảng cáo của Meta **không chia nhỏ được** ("không tạo, không tăng ngân sách" không phải một quyền): `ads_management` là quyền ghi cả tạo lẫn sửa ngân sách. Giới hạn "chỉ nháp, chờ duyệt" phải do **ứng dụng ta tự ép** (tạo luôn trạng thái tạm dừng + người dùng duyệt – nguyên tắc VI). Dùng `ads_management` cần Business Verification + Advanced Access, kéo dài App Review đáng kể và làm tăng rủi ro làm hỏng hồ sơ duyệt của luồng đăng bài (SC-010).
- **Từ khóa xu hướng**: Meta/TikTok không có API xu hướng chung; Hiến pháp VII cấm cào dữ liệu mạng xã hội và nguồn xu hướng đã chốt là RSS báo chính thống + Brave Search (module `trends`). Chỉ có thể dùng dữ liệu hiệu quả **của chính kênh** (nhóm `analytics`) làm đầu vào gợi ý – việc của module `trends`/`content`, không phải 010.

Gợi ý lộ trình: 010 = `publish` + `analytics`; tính năng riêng "Thống kê hiệu quả" dùng nhóm `analytics`; tính năng riêng "Quảng cáo (nháp chờ duyệt)" xin nhóm `ads` bằng `rerequest`; "xu hướng từ dữ liệu kênh" nằm ở `trends`.

Không xin `email`, `public_profile` mở rộng, quyền đọc người theo dõi, tin nhắn (FR-002). Instagram dùng lại quyền đã cấp cho Page khi đủ
(US2-5): nếu mã người dùng dài hạn của Page cùng người dùng còn trong `connect_selections`/kết nối Page và đã có đủ quyền IG → không
chuyển màn hình Facebook; nếu thiếu → chuyển với `auth_type=rerequest` chỉ cho quyền còn thiếu.

**Lý do.** Cùng cách gọi `fetch` + phiên bản cố định của 013 (dễ giả lập, ít phụ thuộc); tách riêng khỏi 009 để "đăng nhập không tự kết nối
Page" (FR-005) là hệ quả của thiết kế chứ không phải của kỷ luật.

**Đã xét.** *`arctic` (đã có ở 009)* – chỉ giải quyết đăng nhập, không xử lý trao đổi mã dài hạn + danh sách Page; thêm bọc không có
lợi. *SDK Facebook chính thức* – thêm phụ thuộc lớn, khó cố định/giả lập. *Facebook Login for Business (cấu hình quyền theo
"configuration")* – hợp lý về sau; hiện đủ bằng `scope`, đổi sang `config_id` là đổi một tham số trong `authorizeUrl`.

## R2 – Ngày hết hạn, làm mới và kiểm tra hằng ngày **[POC-2]**

**Quyết định.** Mỗi bộ chuyển đổi khai báo cách nền tảng *thể hiện* hạn quyền bằng kiểu `ExpiryInfo`:

```ts
type ExpiryInfo =
  | { kind: 'none' }                                  // không có ngày cố định → UI: "Không có ngày hết hạn cố định…"
  | { kind: 'token'; expiresAt: Date }                // mã có hạn (vd TikTok access/refresh, mã Meta ngắn hạn)
  | { kind: 'data_access'; expiresAt: Date };         // hạn truy cập dữ liệu (Meta: người dùng phải cấp lại)
```

- **Meta**: `debug_token` trả `expires_at` (0 = không hết hạn) và `data_access_expires_at`. Hạn hiển thị = `min` các mốc khác 0; nếu cả hai
  bằng 0 → `none`. `tokenRefresh` mặc định `true`: "làm mới" = đổi lại mã người dùng dài hạn (`fb_exchange_token`) khi còn hiệu lực và lấy lại mã Page;
  nếu việc đó không kéo dài được `data_access_expires_at` (cần người dùng cấp lại) thì kết quả là `refreshed` với hạn **không đổi** và hệ thống
  vẫn nhắc theo ngưỡng 7 ngày. *Chưa kiểm chứng với ứng dụng thật* → cờ `META_TOKEN_REFRESH_ENABLED` (mặc định `true`, tắt được không cần phát hành lại).
- **TikTok**: `access_token` sống ngắn (giờ), `refresh_token` sống dài (ngày) – hạn kết nối = hạn `refresh_token`; làm mới mỗi ngày
  (và ngay khi `access_token` hết hạn, vì Worker làm mới trước khi gọi). Cả hai mã lưu mã hóa (`token_ciphertext`, `refresh_ciphertext`).
- **Nhắc** theo ngưỡng cấu hình `channel.expiry_warn_days = 7`; mốc nhắc: 7 ngày (lần đầu rơi vào cửa sổ), 1 ngày, hết hạn (FR-020).
  Khóa chống trùng thông báo có `stage` nên chạy lại việc không gửi lặp.
- **Thu hồi phía nền tảng** phát hiện bằng `checkAccount` hằng ngày (mã lỗi "quyền bị thu hồi"/"Page bị xóa") → "Cần kết nối lại".

**Lý do.** Spec (US5-6, FR-018) buộc phải *không bịa ngày*; thiết kế khai báo cho phép POC-2 chốt số thật mà không sửa luồng.

**Đã xét.** Cứng "60 ngày" cho mọi mã Meta – sai với mã Page không hết hạn, sẽ nhắc nhầm. Không làm mới, chỉ nhắc – bỏ phí khả năng tự gia hạn
(SC-005 ≥ 95% tự làm mới).

## R3 – Mô hình trạng thái và **tương thích ngược** với 012/013

**Vấn đề thực tế (đọc từ `dev`).** `content.service.ts` coi `active|expiring` là dùng được; `publishing/precheck.ts` chỉ dừng ở
`status === 'expired'` hoặc `disconnected` rồi **đi tiếp** `checkAccount` → nếu thêm giá trị `status` mới (vd `needs_reconnect`) mà không ánh xạ, 013 có thể tiếp tục gửi.

**Quyết định.** Hai lớp:

| Lớp | Giá trị | Dùng bởi |
|---|---|---|
| `status` (công khai, **giữ nguyên**) | `active` · `expiring` · `expired` · `disconnected` | 012, 013 (không sửa mã) |
| `state` (**mới**, hiển thị) | `active` · `expiring` · `needs_reconnect` · `ineligible` · `suspended` (+ `disconnected`; "Chưa kết nối" = không có hàng) | màn hình Kênh kết nối |
| `reasonCode` (**mới**) | mã ổn định: `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `SCOPE_MISSING`, `ROLE_TOO_LOW`, `NOT_PROFESSIONAL`, `PAGE_NOT_LINKED`, `SOURCE_PAGE_LOST`, `FEATURE_OFF`, `PLAN_PAUSED`… | giao diện, nhật ký, hỗ trợ |

Ánh xạ `state → status` (hàm thuần `toLegacyStatus`, có kiểm thử bảng): `active→active`, `expiring→expiring`, `needs_reconnect→expired`,
`ineligible→expired`, `suspended→disconnected`, `disconnected→disconnected`. **Bất biến kiểm thử:** `status ∈ {active, expiring}` ⇔ `state ∈ {active, expiring}`;
không bao giờ có `state` không dùng được mà `status` dùng được.

`GET /api/v1/channels` (bộ chọn của 012) giữ hình dạng và **không trả `tiktok`**; thêm trường tùy chọn `state`/`reasonCode` (zod `object` không strict nên 012 vẫn
phân tích được). `ChannelType` mở rộng thêm `tiktok` ở `@app/shared/platform_gateway` **nhưng** `@app/shared/content` giữ nguyên (CHECK của `content.channel_variants` chưa có `tiktok`).

**Đã xét.** *Thêm thẳng giá trị mới vào `status`* – phá an toàn của 013 (xem trên). *Sửa 012/013 để hiểu trạng thái mới* – kéo hai tính năng đã merge vào phạm vi, tăng rủi ro đăng nhầm. 

## R4 – Trạng thái **dẫn xuất** (Instagram ← Page nguồn, TikTok ← công tắc, gói hết hạn)

**Quyết định.** `channel_connections.status` (lưu) chỉ biến đổi theo **sự kiện về chính quyền của kết nối đó** (`active/expiring/needs_reconnect/ineligible/disconnected`).
`state` hiển thị tính bằng hàm thuần `deriveState(row, ctx)`:

1. `disconnected` → `disconnected`.
2. `channel_type = 'tiktok'` và công tắc tắt (hoặc không đọc được) → `suspended` (`FEATURE_OFF`).
3. `channel_type = 'instagram'` và Page nguồn có `state ∉ {active, expiring}` hoặc đã ngắt → `needs_reconnect` (`SOURCE_PAGE_LOST`).
4. còn lại → trạng thái lưu (`expiring` suy từ `token_expires_at` còn < `warn_days` khi chưa `needs_reconnect`).

Gói hết hạn (FR-033) **không** đổi `state` (kênh vẫn "xem/ngắt được"); chỉ **dừng** việc nền và lời gọi nền tảng; cờ `recheck_required` bật để kiểm tra lại khi gia hạn (US7-7).

**Lý do.** Không có dữ liệu "trạng thái phụ" lệch pha (công tắc đổi ⇒ hiệu lực ≤ 1 phút, đúng SC-011; Page phục hồi ⇒ Instagram tự đúng – FR-042); ít ghi, ít đua.
Thông báo "chuyển trạng thái" do **điểm ghi** quyết định (khi Page chuyển `needs_reconnect`/`disconnected`, hàm ghi tìm các Instagram có `source_connection_id` và phát *một* thông báo gom).

**Đã xét.** Ghi `suspended` vào CSDL qua việc định kỳ – chậm (hiệu lực theo chu kỳ job, không ≤ 1 phút) và có cửa sổ gọi nền tảng sai.

## R5 – Công tắc TikTok: nơi sở hữu, lưu trữ, hiệu lực

**Quyết định.** Module sở hữu = **`platform_gateway`** (không phải `account`):

- `platform_gateway.gateway_settings` (**dùng chung**, không `account_id`): khóa/giá trị JSONB — `channel.tiktok.enabled_default=false`, `channel.max_per_platform=5`,
  `channel.expiry_warn_days=7`, `channel.manual_check_cooldown_sec=20`, `channel.selection_ttl_sec=600`. Đổi không cần phát hành.
- `platform_gateway.feature_overrides` (**tenant**): `(account_id, flag_key)` duy nhất, `value boolean` (không có dòng = "theo mặc định").
- `platform_gateway.feature_override_events` (**tenant**, chỉ thêm): ai, giá trị cũ → mới, lý do bắt buộc, lúc nào (FR-037).
- Cổng đọc `FeatureGate.isEnabled(flag)` trong ngữ cảnh tài khoản: `override ?? default`; cache trong tiến trình **≤ 60 giây** theo `(account, flag)` (không thuộc
  nhóm cấm cache; đổi qua API nhân viên thì xóa cache của bản đó, bản khác chờ ≤ 60 giây); **lỗi đọc → tắt** (FR-038) kèm log.
- **Chặn ở API *và* Worker**: mọi thao tác của `PlatformGatewayService`/`ConnectionsService` với `channelType = 'tiktok'` gọi `requireFeature('channel.tiktok')` *trước* khi chạm adapter; việc nền `check_connection` cũng kiểm. Lỗi `FEATURE_NOT_ENABLED` (HTTP 403 cho API; việc nền bỏ qua + ghi nhật ký).
- Đổi cấu hình: `PUT /api/v1/staff/…` (`@StaffAccess('feature.manage')`, chỉ `admin`) hoặc `pnpm staff feature …`; một giao dịch ghi cấu hình + sự kiện + `infra.audit_log`.

**Lý do.** Chỉ cổng cần chặn gọi nền tảng; đặt ở `account` thêm phụ thuộc (`platform_gateway → account` đã cần cho gói, nhưng công tắc cần đọc ở mọi thao tác, nên giữ gần nơi dùng). Cơ chế "khóa → giá trị" đủ chung cho tính năng khác (Assumptions) mà không làm sớm bảng `feature_flags` toàn hệ thống.

**Đã xét.** Biến môi trường (cần phát hành – trái SC-012). Cấu hình trong `infra.queue_settings` (sai miền sở hữu). Đưa vào `account` (phụ thuộc rộng hơn không cần thiết).

## R6 – Phiên kết nối, chọn nhiều Page, kết nối lại

**Quyết định.**

- `connect_states` (tenant): `state_hash = SHA-256(state 32 byte ngẫu nhiên)`, `user_id`, `channel_type`, `reconnect_connection_id?`, `expires_at = +10 phút`, `used_at`; dùng một lần bằng
  `UPDATE … SET used_at = now() WHERE state_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING …` (cùng ngữ nghĩa với 005). Lượt gọi lại phải do **đúng người dùng đang đăng nhập** (so `user_id`).
- `connect_selections` (tenant): ứng viên + **mã quyền đã mã hóa** (nhiều ứng viên ⇒ mỗi ứng viên mã hóa riêng, AAD chứa `selection_id`+`external_id`), `expires_at = +10 phút`, `used_at`; việc dọn
  hằng giờ **xóa hẳn** dòng hết hạn/đã dùng (FR-004, US4-7).
- Chọn nhiều: `POST /channels/selections/:id/confirm {externalIds[]}` → xử lý **từng Page độc lập** (không "tất cả hoặc không có gì"), nhưng **chặn từ đầu** nếu số chọn > chỗ còn lại (không kết nối một phần ngoài ý muốn): một giao dịch/Page, khóa tư vấn theo `(account, type)` để đếm không đua.
- Kết nối lại: `connect {reconnectConnectionId}` ghi vào `connect_states`; sau gọi lại, nếu ứng viên có `external_id` **bằng** kênh gốc → cập nhật token tại chỗ (`updateVersioned`, giữ `id`), nếu không → `WRONG_CHANNEL` và kênh cũ không đổi (FR-008). Không qua màn hình chọn Page.
- Chống bấm đôi / hai thẻ: chỉ mục duy nhất một phần; luồng đến sau nhận `ALREADY_CONNECTED` (đọc lại hàng có sẵn trong **ngữ cảnh tenant** – nếu thuộc tài khoản khác thì `OWNED_BY_ANOTHER_ACCOUNT`).

**Lý do.** Tái sử dụng hình dạng 005 (đã có kiểm thử) nên giảm rủi ro; thêm ba điểm: nhiều Page, kết nối lại, mã hóa theo ứng viên.

## R7 – Đảo phụ thuộc bằng cổng ngược `ConnectionConsumersPort`

**Quyết định.** `platform_gateway/public-api.ts` xuất `ConnectionConsumersPort` + `registerConnectionConsumers(port)` (đăng ký lúc `onModuleInit`, giống `registerAdapter`):

```ts
interface ConnectionConsumersPort {
  scheduledImpact(connectionIds: readonly string[]): Promise<Map<string, { count: number; nextAt: Date | null }>>;
  onDisconnect(tx: Db, connectionId: string): Promise<{ cancelled: number }>;      // = publishing.cancelAllForConnection
  errorMappings(): Promise<ErrorMappingRow[]>;                                      // = bảng publishing.error_mappings (013)
}
```

`publishing` hiện thực (nó đã phụ thuộc `platform_gateway` nên **không** thêm cạnh mới): `scheduledImpact` là hàm đọc mới `countScheduledByConnections` (cộng thêm vào `PublishingPublicApi`),
`onDisconnect` gọi `cancelAllForConnection` (013 đã có), `errorMappings` trả dòng đã nạp. Chưa đăng ký (chạy riêng 010) → cổng dùng bản rỗng (`count 0`), không lỗi.

**Lý do.** Giữ đồ thị phụ thuộc không vòng (Hiến pháp IV) và vẫn hủy lượt **trong cùng giao dịch** với ngắt (Hiến pháp II/IV).

**Đã xét.** `platform_gateway → publishing` (vòng); sự kiện qua hàng chờ (mất tính nguyên tử, lượt có thể đăng sau khi đã ngắt).

## R8 – Giới hạn N kết nối/nền tảng và "một Page – một tài khoản" an toàn khi đua

**Quyết định.** Trong **một giao dịch** cho mỗi lần chèn kết nối:

1. `pg_advisory_xact_lock(hashtextextended('channel_limit:' || account_id || ':' || platform, 0))`.
2. Đếm `status <> 'disconnected'` của `(account, platform)`; nếu `≥ N` (đọc `gateway_settings`) → `LIMIT_REACHED {used, limit}`. `platform` = `facebook_page`, `instagram`, `tiktok` (mỗi loại kênh một nhóm).
3. `INSERT` – chỉ mục duy nhất **toàn cục** `(channel_type, external_id) WHERE status <> 'disconnected'`: nếu vi phạm, đọc lại trong tenant: có ⇒ `ALREADY_CONNECTED`; không ⇒ `OWNED_BY_ANOTHER_ACCOUNT` (không lộ gì thêm).
4. Kết nối "Cần kết nối lại" vẫn tính; ngắt trả chỗ ngay (`status='disconnected'`, `disconnected_at`).

Một Page ngắt rồi kết nối lại tạo **hàng mới** (US7-3); hàng cũ giữ để truy vết lượt đăng. Chỉ mục duy nhất một phần cho phép điều đó.

**Lý do.** Khóa tư vấn chỉ xếp hàng cùng `(tài khoản, nền tảng)` nên không nghẽn toàn hệ thống; chỉ mục duy nhất là chốt chặn cuối đúng tinh thần Hiến pháp II (ràng buộc DB, không chỉ mã).

## R9 – TikTok: phạm vi bộ chuyển đổi trong 010

**Quyết định.** `TiktokAdapter` (đăng ký trong `registry.ts` **chỉ khi** `driver=real`; luôn có bản giả cho dev/test) hiện thực **đủ phần kết nối**: `authorizeUrl`, `exchangeCallback`, `checkAccount` (tài khoản dùng được cho đăng bài,
đã cấp quyền đăng video `video.publish`/`video.upload`, `max_video_post_duration_sec` nếu có), `refreshToken` (dùng `refresh_token`), `revoke`, `mediaRules` (chỉ video), `classifyError` + bảng lỗi riêng.
`submit/checkStatus/reconcile` **chưa hiện thực đăng thật**: trả `failed` loại `user_action` (`TIKTOK:POSTING_NOT_AVAILABLE`, remedy `contact_support`) – không bao giờ `transient`, nên không thể bị thử lại thành đăng trùng; khả năng
`reconcile=false`, `asyncProcessing=true`. Đăng TikTok thật = tính năng sau, kèm sửa `content` (CHECK + quy tắc video) và POC.

Phù hợp spec FR-040/041 (kết nối + kiểm thử hợp đồng + bản giả) mà không bịa hành vi đăng chưa thể kiểm chứng.

Quyền xin mặc định (`CHANNEL_SCOPES_TIKTOK`, **[POC-2/TikTok review]**): `user.info.basic`, `video.publish` (hoặc `video.upload` cho ứng dụng chưa duyệt – chế độ nháp). Giao diện hiện "TikTok chỉ đăng video" + "đang thử nghiệm" khi `TIKTOK_APP_STATUS != approved`.

## R10 – Kho mã quyền: mã hóa phong bì + `KeyWrapper`

**Quyết định.** `CredentialVault` giữ nguyên giao diện (`encrypt`, `decrypt → DecryptedCredential`); thêm `KmsCredentialVault`:

- Mỗi lần mã hóa: sinh khóa dữ liệu 256 bit ngẫu nhiên (DEK) → AES-256-GCM với **AAD = `accountId|purpose|refId`** (chống đem bản mã của kết nối này gán sang kết nối khác) → DEK được **bọc** bằng `KeyWrapper.wrap(dek)`.
- Định dạng bản mã có phiên bản: `v1 | keyId(len+bytes) | wrappedDek(len+bytes) | iv(12) | tag(16) | ciphertext` → xoay khóa = thêm `keyId` mới, giải mã bản cũ bằng `keyId` ghi trong bản mã; có việc bảo trì "bọc lại" sau này (ngoài phạm vi).
- `KeyWrapper` có hai bản: `kms` (gọi dịch vụ quản lý khóa của nhà cung cấp – **K5, chưa có API chốt**) và `env-master-key` (khóa chủ 256 bit trong Kubernetes `Secret`, **không** nằm trong CSDL/ảnh container).
  `assert-no-fakes` mở rộng: production **bắt buộc** `kms`; staging cho phép `env-master-key` khi `STAGING_ALLOW_ENV_MASTER_KEY=true`; `FakeCredentialVault` chỉ development/test.
- Giải mã chỉ trong `ConnectionsService`/`PlatformGatewayService` ngay trước lời gọi; kết quả là `DecryptedCredential` có nhãn (in/JSON ra `[credential]`). Không bộ nhớ đệm bản rõ. Hàm `revealCredential` chỉ import được trong `internal/adapters` (quy tắc ESLint hiện có của 005, mở rộng cho `tiktok/`).

**Lý do.** Hiến pháp VII (khóa nằm ngoài CSDL; sao lưu CSDL một mình không đủ), không tự viết mật mã mới (dùng AES-GCM của `node:crypto`, mẫu phong bì tiêu chuẩn), và đổi nhà cung cấp KMS chỉ là đổi `KeyWrapper`.

**Đã xét.** Mã hóa cột bằng `pgcrypto` (khóa đi qua CSDL – trái VII). Một khóa dùng chung cho mọi bản ghi (không xoay được, không AAD). Chờ KMS rồi mới làm (chặn staging và hồ sơ Meta SC-010).

## R11 – Việc nền hằng ngày: phân tán theo tenant, idempotent, tôn trọng gói

**Quyết định.** Ba loại việc (chi tiết ở [contracts/jobs-and-notifications.md](./contracts/jobs-and-notifications.md)):

1. `platform_gateway.channel_maintenance` – định kỳ hằng ngày 03:00 (UTC+7), phạm vi `system`: gọi hàm `SECURITY DEFINER` `platform_gateway.list_due_connections(limit)` (chỉ trả `(account_id, connection_id)`, không mã quyền/tên) rồi tạo việc con.
2. `platform_gateway.check_connection` – phạm vi `tenant`, hàng chờ `scheduled`, khóa `check_connection:{connectionId}:{yyyymmdd}`; thân việc: kiểm gói (`account.getPublishingEligibility()`), kiểm công tắc (TikTok), đọc → gọi nền tảng ngoài giao dịch → ghi `updateVersioned`; phát thông báo trong cùng giao dịch ghi.
3. `platform_gateway.cleanup_connect_data` – hằng giờ, xóa `connect_states`/`connect_selections` hết hạn/đã dùng.

Chạy lại hai lần cho cùng kết quả: bước ghi so `version`; thông báo có khóa chống trùng theo `(connectionId, stage, ngày hạn)`; "làm mới" lần hai thấy hạn mới đã ghi ⇒ không làm gì. Hai Worker cùng lấy: khóa chống trùng của hàng chờ + `version`.

Gói hết hạn → việc **không gọi nền tảng, không nhắc**, chỉ đặt `recheck_required = true` (một lần); sau gia hạn, lần chạy kế tiếp kiểm tra lại từng kết nối độc lập (US7-7).

**Lý do.** Mẫu y như `publishing.sweep_overdue` + việc theo tài khoản của 013/003; tách "liệt kê" (system) khỏi "xử lý" (tenant) để không bao giờ đọc mã quyền ngoài ngữ cảnh tenant (Hiến pháp I, V).

## R12 – Giao diện, trợ năng, thông báo, kiểm toán, chỉ số

- **Web**: thay `comingSoon('/channels')` bằng `ChannelsPage` (lười tải); dữ liệu qua `useApiQuery(queryKeys.channels.overview())`; không gọi nền tảng khi xem; trạng thái bằng **chữ + biểu tượng** (bộ thành phần `Badge`/`Alert`/`Card` của 011); cảnh báo đầu trang liệt kê
  từng kết nối; chỉ báo ở menu qua `nav-registry` (trường `attention`); ở 360 px thẻ xếp một cột, vùng chạm ≥ 44 px; lọc nền tảng/trạng thái dạng chip; hộp xác nhận ngắt nêu số bài + Instagram liên quan. TikTok: chỉ vẽ khi `overview.features.tiktok = true`.
- **Quyền**: `channel.view` (chủ + CTV) dùng cho `overview`; `channel.manage` (chủ) cho connect/confirm/recheck/disconnect; điểm cuối cũ `GET /channels` giữ `status.view`.
- **Thông báo**: gom theo đợt (một thông báo/email liệt kê nhiều kênh – FR-035) bằng `refs.connectionIds`; mốc 7 ngày/1 ngày/hết hạn + `channel_needs_reconnect` (kèm `affectedPosts` làm tham số hiển thị, không số tiền, không nội dung bài).
- **Kiểm toán** (`infra.audit_log`, 12 tháng): `channel.connect`, `channel.connect_failed`, `channel.reconnect`, `channel.recheck`, `channel.disconnect`, `channel.state_changed`, `feature.set`, `support.view_channel` — metadata chỉ `{connection_id, channel_type, result, reason_code, trace_id}`; **không** mã quyền, tên Page đầy đủ hay dữ liệu cá nhân.
- **Chỉ số** (OpenTelemetry, gắn `account_id` ở nhãn *log*, không ở nhãn chỉ số có cardinality cao): `channel_connections{state,type}`, `channel_expiring_lt7d`, `channel_refresh_total{result}`, `channel_connect_total{result}`; cảnh báo vận hành "quyền còn < 7 ngày" dùng chung ngưỡng.
- **Hỗ trợ**: `supportViewAccount` đọc qua khung nhìn `platform_gateway.support_channel_view` (không có cột bí mật) — mỗi lần xem ghi `support.view_channel`.

## Kết quả thi công và dữ kiện còn thiếu (T090, 2026-11-19)

Đã chạy toàn bộ luồng với Graph/TikTok giả (e2e `channels-*`, `secret-scan`, test DB/hàng chờ). **Chưa kiểm chứng với nền tảng thật** (cập nhật POC-2):

- R1/R2 (Meta): hạn thật của mã Page, `data_access_expires_at`, quyền tối thiểu, `debug_token` bằng POST – đều là giả định theo stub.
- Làm mới Meta (`fb_exchange_token` rồi `me/accounts`) và thu hồi (`DELETE me/permissions`) cần thử với ứng dụng Meta thật.
- TikTok: `creator_info/query`, `refresh_expires_in`, `oauth/revoke` là giả định; đăng bài thật chưa làm.
- Quickstart thủ công (10 kịch bản) chưa chạy trên trình duyệt/Docker đầy đủ; Playwright 360/768/1280 px (T048) chưa chạy.

**Rủi ro còn mở:** KMS thật (K5); App Review quyền `ads`/`analytics`; TikTok chưa duyệt ứng dụng; hồ sơ Q-D3/C6 cần thêm TikTok trước khi bật công tắc.
