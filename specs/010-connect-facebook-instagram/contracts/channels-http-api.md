# Hợp đồng HTTP – Kết nối kênh (010)

Tiền tố `/api/v1`. Kiểu dùng chung ở `@app/shared/platform_gateway` (zod). Mọi phản hồi **không bao giờ** chứa mã quyền, `code` OAuth, bí mật ứng dụng (FR-014).
Mã tài khoản **luôn từ phiên** (guard 004), không có ở path/query/body của điểm cuối khách hàng (FR-004). Lỗi theo `AppError` của 004: `{ code, message(vi), actions[] }` – mỗi lỗi ≥ 1 hành động khắc phục (nguyên tắc VI).
Kết nối không thuộc tài khoản hoặc không tồn tại → cùng một `404 CONNECTION_NOT_FOUND` (US4-4).

## 1. Điểm cuối khách hàng

| Phương thức + đường dẫn | Quyền | Mô tả |
|---|---|---|
| `GET /channels` *(đã có, 005)* | `status.view` | Bộ chọn kênh của 012. **Hình dạng cũ**, không trả `tiktok`; thêm `state?`, `reasonCode?` tùy chọn |
| `GET /channels/overview` **(mới)** | `channel.view` | Dữ liệu cho màn hình Kênh kết nối (chỉ dữ liệu đã lưu, **không gọi nền tảng** – FR-028) |
| `POST /channels/connect` *(mở rộng)* | `channel.manage` | Bắt đầu kết nối/kết nối lại; trả `authorizeUrl` |
| `GET /channels/callback/:channelType` *(mở rộng)* | phiên chủ | Nhận lượt gọi lại, `302` về giao diện |
| `GET /channels/selections/:selectionId` *(mở rộng)* | `channel.manage` | Danh sách ứng viên để chọn |
| `POST /channels/selections/:selectionId/confirm` **(mới)** | `channel.manage` | Xác nhận một hoặc nhiều ứng viên, kết quả từng cái |
| `POST /channels` *(đã có, giữ để tương thích 005)* | `channel.manage` | Lưu **một** ứng viên (`externalId`) – ủy quyền cho `confirm` |
| `POST /channels/:connectionId/recheck` **(mới)** | `channel.manage` | "Kiểm tra lại" một kết nối (có giới hạn tần suất) |
| `GET /channels/:connectionId/disconnect-preview` **(mới)** | `channel.manage` | Hậu quả của ngắt: số bài, Instagram liên quan |
| `DELETE /channels/:connectionId` *(đã có, mở rộng)* | `channel.manage` | Ngắt: xóa mã quyền ngay, thu hồi phía nền tảng nếu được |

Quyền mới trong `packages/shared/src/auth/permissions.ts`: `channel.view` = chủ + CTV; `channel.manage` giữ (chỉ chủ). Cộng tác viên gọi `channel.manage` → `403 PERMISSION_DENIED` + ghi nhật ký (Edge Case).

### 1.1 `GET /channels/overview`

```ts
OverviewResponse = {
  features: { tiktok: boolean },                    // công tắc đã tính (override ?? default); lỗi đọc → false
  limits: { perPlatform: number },                  // 5
  platforms: Array<{                                // luôn: facebook_page, instagram; + tiktok nếu features.tiktok
    channelType: 'facebook_page' | 'instagram' | 'tiktok',
    used: number,                                   // kết nối chưa ngắt (kể cả cần kết nối lại)
    limit: number,
    canAdd: boolean,                                // used < limit && plan còn hạn && chủ
    experimental?: boolean,                         // TikTok chưa qua xét duyệt → "đang thử nghiệm"
    note?: string                                   // vd "TikTok chỉ đăng video" (chuỗi do máy chủ cấp, tiếng Việt)
  }>,
  connections: ChannelOverviewItem[],
  attention: Array<{ connectionId, kind: 'expiring' | 'needs_reconnect' | 'ineligible', daysLeft?: number }>,
  planActive: boolean,                              // gói hết hạn → chặn kết nối mới (FR-033), vẫn xem/ngắt
  viewerCanManage: boolean                          // chủ = true; CTV = false (giao diện ẩn nút – API vẫn chặn)
}

ChannelOverviewItem = {
  connectionId: uuid, channelType, displayName: string(≤120), shortCode: string(6),   // mã rút gọn từ connectionId
  avatarUrl: string | null,
  state: 'active'|'expiring'|'needs_reconnect'|'ineligible'|'suspended',
  reasonCode: string | null, reasonVi: string | null, actionsVi: Array<{ kind: 'reconnect'|'recheck'|'disconnect'|'wait'; labelVi: string }>,
  expiry: { kind: 'none' | 'token' | 'data_access', expiresAt: string | null, daysLeft: number | null },
  conditions: { accountType: string | null, scopes: Array<{ nameVi: string; granted: boolean }>, quotaRemaining: number | null },
  sourceConnectionId: uuid | null, sourceDisplayName: string | null,        // Instagram → Page nguồn
  scheduledImpact: { count: number; nextAt: string | null },                // từ cổng ngược; thiếu → { 0, null }
  lastCheckedAt: string | null, connectedAt: string,
  supportDetails: { lastErrorCode: string | null }                           // chỉ hiện ở "Chi tiết cho hỗ trợ"
}
```

Sắp xếp: theo nền tảng, trong nền tảng ưu tiên trạng thái cần chú ý rồi `connectedAt`. `Cache-Control: no-store` (trạng thái quyền không cache). Mục tiêu ≤ 1 giây (1 truy vấn kết nối + 1 truy vấn đếm lịch).

### 1.2 `POST /channels/connect`

```ts
ConnectRequest  = { channelType: 'facebook_page'|'instagram'|'tiktok', reconnectConnectionId?: uuid }   // strict
ConnectResponse = { authorizeUrl: string }
```

Lỗi: `403 FEATURE_NOT_ENABLED` (TikTok tắt – không gọi nền tảng), `403 PLAN_EXPIRED` ("Gói đã hết hạn" + cách liên hệ gia hạn; áp cho cả kết nối mới lẫn kết nối lại vì FR-033 dừng mọi lời gọi sang nền tảng khi gói hết hạn), `409 LIMIT_REACHED {used, limit}` (chỉ khi **không** phải kết nối lại), `404 CONNECTION_NOT_FOUND` (kết nối lại sai mã), `503 PROVIDER_UNAVAILABLE` ("Tính năng kết nối đang được chuẩn bị" khi ứng dụng Meta chưa duyệt/ chưa cấu hình).

### 1.3 `GET /channels/callback/:channelType`

Chuyển hướng `302` (không JSON, vì là điều hướng trình duyệt):
- Thành công, cần chọn → `/channels/select/:selectionId`.
- Kết nối lại thành công → `/channels?reconnected=:connectionId`.
- Lỗi → `/channels?error=<code>` với `code ∈ CONNECT_CANCELLED | STATE_INVALID | STATE_EXPIRED | WRONG_CHANNEL | FEATURE_NOT_ENABLED | PROVIDER_UNAVAILABLE | SCOPE_MISSING | NO_CANDIDATES`.
`state` sai/hết hạn/đã dùng/của người khác/khác loại kênh ⇒ `STATE_INVALID` (không tạo gì, không lộ lý do). Thiếu/sai phiên → `302 /login` hoặc `?error=STATE_INVALID` (như 005).

### 1.4 `GET /channels/selections/:selectionId`

```ts
SelectionResponse = {
  channelType, remainingSlots: number, limit: number,
  candidates: Array<{
    externalId: string, displayName: string, avatarUrl: string | null, accountType: string | null,
    selectable: boolean,
    blocked: null | { code: 'ALREADY_CONNECTED' | 'OWNED_BY_ANOTHER_ACCOUNT' | 'INELIGIBLE' | 'SCOPE_MISSING' | 'ROLE_TOO_LOW' | 'NOT_PROFESSIONAL' | 'PAGE_NOT_LINKED',
                       messageVi: string, remedies: Array<{ action: RemedyAction; labelVi: string }> }   // ≥ 1
  }>
}
```

Người khác (không phải người khởi động) hoặc hết hạn/đã dùng → `404 SELECTION_NOT_FOUND` (hành động "Thử kết nối lại"). Mã quyền của ứng viên **không** ra khỏi máy chủ.
(Kiểm tra điều kiện của từng ứng viên đã chạy lúc gọi lại; màn hình chọn chỉ đọc kết quả lưu.)

### 1.5 `POST /channels/selections/:selectionId/confirm`

```ts
ConfirmRequest  = { externalIds: string[] /* 1..remainingSlots; ≤ 20 */ }          // strict
ConfirmResponse = { results: Array<{
    externalId: string,
    outcome: 'created' | 'already_connected' | 'owned_by_another_account' | 'ineligible' | 'limit_reached' | 'not_in_selection',
    connection?: ChannelOverviewItem,           // khi created
    error?: { messageVi: string; remedies: [...] }   // ≥ 1 hành động
}> }
```

- Chọn **nhiều hơn chỗ còn lại** → `409 LIMIT_REACHED` **trước khi** tạo bất cứ kết nối nào (Edge Case "vượt giới hạn giữa lúc chọn nhiều Page").
- Mỗi ứng viên xử lý trong giao dịch riêng (R8); một ứng viên lỗi không ảnh hưởng ứng viên khác. Sau khi mọi ứng viên đã xử lý xong, dòng phiên bị xóa (mã quyền ứng viên không được chọn bị hủy).
- TikTok: kiểm lại công tắc ở bước này (Edge Case): tắt → `403 FEATURE_NOT_ENABLED`, hủy phiên.
- Gói hết hạn → `403 PLAN_EXPIRED`.

### 1.6 `POST /channels/:connectionId/recheck`

Giới hạn tần suất: cập nhật có điều kiện `last_manual_check_at < now() - cooldown` (mặc định 20 giây); vượt → `429 RECHECK_TOO_SOON {retryAfterSec}`.
Gọi `checkAccount` (+ làm mới nếu hạn gần) ngoài giao dịch, rồi ghi `updateVersioned`. Trả `{ connection: ChannelOverviewItem, result: 'ok' | 'changed' | 'unavailable' }`.
Nền tảng tạm thời không phản hồi → `200 {result: 'unavailable', messageVi: 'Chưa kiểm tra được, thử lại sau'}` **không** đổi trạng thái (FR-012, US3-5). Instagram: khi Page nguồn đã hoạt động lại, "Kiểm tra lại" đưa Instagram về `active` nếu còn đủ điều kiện, **không** bắt cấp quyền lại (FR-042).

### 1.7 `GET /channels/:connectionId/disconnect-preview` và `DELETE /channels/:connectionId`

```ts
DisconnectPreview = {
  connectionId, displayName,
  scheduledImpact: { count: number; nextAt: string | null },        // bài đã lên lịch cho riêng kênh này (cổng ngược)
  dependents: Array<{ connectionId, displayName, channelType: 'instagram' }>   // IG liên kết qua Page này (FR-042)
}
DisconnectResponse = { disconnected: true, revoked: 'done' | 'failed' | 'skipped', hintVi?: string, cancelledAttempts: number }
```

`DELETE` trong **một giao dịch**: `status='disconnected'`, `disconnected_at`, hai cột `*_ciphertext := NULL`, `onDisconnect` (hủy lượt chưa gửi), kiểm toán, thông báo gom cho Instagram phụ thuộc. Thu hồi phía nền tảng thực hiện **sau** khi giải mã tạm ngay trước khi xóa (đọc mã → xóa → gọi thu hồi bằng bản trong bộ nhớ, thời gian chờ 5 giây); thất bại ⇒ `revoked:'failed'` + `hintVi` ("Bạn có thể gỡ ứng dụng trong cài đặt Facebook") – **vẫn xóa** phía mình (FR-017). Đã ngắt → `200` idempotent (`disconnected:true`). Bài và lịch sử **không** bị xóa (FR-029); lượt đang `processing`/`unknown` để chạy xong (013).

## 2. Điểm cuối nhân viên (`/staff/*`, `@StaffAccess`)

| Phương thức + đường dẫn | Quyền | Mô tả |
|---|---|---|
| `GET /staff/features/channel.tiktok` | `feature.manage` | Mặc định hệ thống + tóm tắt số ghi đè |
| `PUT /staff/features/channel.tiktok/default` | `feature.manage` | `{ enabled: boolean, reason: string(1..500) }` – đổi mặc định toàn hệ thống |
| `PUT /staff/accounts/:accountId/features/channel.tiktok` | `feature.manage` | `{ value: 'on'|'off'|'default', reason: string(1..500) }` – ghi đè theo tài khoản |
| `GET /staff/accounts/:accountId/channels` | `support.lookup` | Khung nhìn hỗ trợ (không có mã quyền); ghi `support.view_channel` |

`accountId` ở đường dẫn **chỉ** cho nhân viên (mẫu `supportViewAccount` của 004, có kiểm toán); khách hàng không có tham số này. `reason` bắt buộc; thiếu → `422`. Hiệu lực ≤ 60 giây (cache tiến trình; bản xử lý yêu cầu xóa cache ngay).
Chủ, CTV, hỗ trợ (`support`) gọi `PUT` → `403` (`feature.manage` chỉ `admin`). Lệnh nội bộ `pnpm staff feature set-default|set <accountId>|get` bọc cùng `features.service` (cùng kiểm toán).

## 3. Mã lỗi (bảng tiếng Việt, mỗi dòng ≥ 1 hành động)

| `code` | HTTP | Thông điệp (rút gọn) | Hành động |
|---|---|---|---|
| `FEATURE_NOT_ENABLED` | 403 | Tính năng chưa mở cho tài khoản của bạn | Quay lại Kênh kết nối |
| `PLAN_EXPIRED` | 403 | Gói đã hết hạn nên chưa kết nối thêm được | Liên hệ gia hạn · Xem kênh hiện có |
| `LIMIT_REACHED` | 409 | Bạn đã kết nối tối đa N kênh {nền tảng}. Hãy ngắt bớt kênh không dùng | Ngắt bớt kênh |
| `ALREADY_CONNECTED` | 409 | Kênh này đã được kết nối | Xem kênh |
| `OWNED_BY_ANOTHER_ACCOUNT` | 409 | Page này đang được kết nối ở một tài khoản khác. Hãy ngắt ở tài khoản đó trước hoặc liên hệ hỗ trợ | Liên hệ hỗ trợ |
| `WRONG_CHANNEL` | 409 | Đây là Page khác với kênh đang kết nối. Hãy ngắt kênh hiện tại nếu muốn đổi sang Page khác | Chọn lại · Ngắt kênh |
| `STATE_INVALID` / `STATE_EXPIRED` | 400 | Phiên kết nối đã hết hạn, hãy bắt đầu lại | Kết nối lại từ đầu |
| `SELECTION_NOT_FOUND` | 404 | Phiên chọn trang đã hết hạn hoặc không tồn tại | Thử kết nối lại |
| `CONNECTION_NOT_FOUND` | 404 | Không tìm thấy kết nối kênh này | Tải lại danh sách |
| `RECHECK_TOO_SOON` | 429 | Bạn vừa kiểm tra xong, hãy thử lại sau ít giây | Chờ {n} giây |
| `PROVIDER_UNAVAILABLE` | 503 | Tính năng kết nối đang được chuẩn bị | Thử lại sau · Liên hệ hỗ trợ |
| `CHANNEL_INELIGIBLE` | 422 | (thông điệp từ bảng lỗi theo điều kiện chưa đạt) | theo `remedies` |
