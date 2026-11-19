# Kết nối kênh: Facebook Page, Instagram, TikTok (010)

Hướng dẫn cho lập trình viên của module `platform_gateway` (đặc tả: `specs/010-connect-facebook-instagram/`).
Phạm vi: kết nối bằng OAuth, mã quyền mã hóa, trạng thái dẫn xuất, việc nền (kiểm tra / làm mới / nhắc hạn), công tắc TikTok.
Đăng bài thuộc 013; bốn điểm phụ thuộc chung xem [gateways.md](./gateways.md).

## 1. Cấu trúc

```text
platform_gateway/internal/
  adapters/                 meta/ (facebook, instagram, graph-client, meta-oauth), tiktok/, registry.ts,
                            feature-guarded-adapter.ts (decorator công tắc)
  connections/              connections.service.ts (luồng kết nối), connections.controller.ts, staff-channels.controller.ts,
                            pg-connection-store.ts, connection-state.ts (trạng thái dẫn xuất, hàm thuần), overview-mapper.ts,
                            channel-audit.ts (kiểm toán), consumers.ts (cổng ngược)
  vault/                    credential-vault.ts (AAD), kms-credential-vault.ts, env-master-key.wrapper.ts, kms.wrapper.ts
  features/                 feature-gate.ts (cache ≤ 60 giây), features.service.ts, staff-features.controller.ts
  maintenance/              jobs.ts, due-connections.ts, check-connection.handler.ts, cleanup.handler.ts, disconnect-all.handler.ts
  notify/channel-notify.ts  thông báo gom (cùng giao dịch ghi trạng thái)
  metrics.ts                chỉ số OpenTelemetry
```

Web: `apps/web/src/features/channels/` (trang `ChannelsPage`, `SelectChannelsPage`, thẻ, hộp ngắt…).

## 2. Mã quyền: kho mã hóa phong bì

- Mỗi bản ghi có DEK riêng (AES-256-GCM). DEK được bọc bằng khóa chủ: `KmsKeyWrapper` (chờ K5) hoặc `EnvMasterKeyWrapper`
  (khóa trong `CREDENTIAL_MASTER_KEY_B64`, dev/test và staging có điều kiện; production bị `assert-no-fakes` từ chối).
- **AAD** = `accountId|purpose|channelType:externalId`. Bản mã đem sang tài khoản, kênh hoặc mục đích khác (`token` ↔ `refresh`)
  giải mã thất bại. (Khác văn bản `selection_id+external_id` của tasks T017: dùng định danh kênh vì ổn định qua phiên chọn Page.)
- Xoay khóa: chuỗi cấu hình là danh sách khóa phân tách bằng dấu phẩy; khóa đầu bọc DEK mới, các khóa sau chỉ giải mã bản cũ.
- Chọn kho bằng `CREDENTIAL_VAULT_DRIVER` (`fake` | `env-master-key` | `kms`). `DecryptedCredential` in ra `[credential]`.
- Mã quyền KHÔNG BAO GIỜ vào nhật ký, URL, phản hồi, thông báo hay dữ liệu việc nền (kiểm bởi `secret-scan.e2e.spec.ts`).
  Mã chỉ đi trong tiêu đề `Authorization`; `code`, `client_secret`, `fb_exchange_token` đi trong THÂN form.

## 3. Trạng thái

CSDL lưu 4 giá trị: `active | needs_reconnect | ineligible | disconnected`. Trạng thái **hiển thị** do `deriveState` dẫn xuất
(hàm thuần, kiểm thử bảng): thêm `expiring` (còn < `channel.expiry_warn_days` ngày), `suspended` (TikTok tắt công tắc),
`needs_reconnect/SOURCE_PAGE_LOST` (Instagram mà Page nguồn hỏng). Dẫn xuất nên bật/tắt công tắc có hiệu lực ngay và Page phục hồi
thì Instagram tự đúng, không cần dọn dòng phụ. `status` công khai cho 012/013 giữ 4 giá trị cũ (`toLegacyStatus`): mọi trạng thái
không dùng được ánh xạ về `expired`/`disconnected` để `precheck` dừng, không bao giờ đăng bằng quyền hỏng.

Quy tắc bất biến (FR-012): **chỉ kết luận khẳng định** (`user_action`) mới đổi trạng thái. Lỗi mạng, 5xx, mã lạ ⇒ `unavailable` /
`deferred`, giữ nguyên trạng thái và KHÔNG cập nhật `last_checked_at`.

Ghi bằng cập nhật có điều kiện theo `version` (`updateRow` → `updateVersioned`); đua với người dùng kết nối lại: bản ghi có
`token_issued_at` mới hơn thắng.

## 4. Luồng kết nối (HTTP: `/api/v1/channels`)

`connect` (lưu băm `state` gắn phiên + người dùng, dùng một lần) → trang ủy quyền → `callback/:channelType` → phiên chọn Page
(mỗi ứng viên mang bản mã riêng) → `selections/:id/confirm` (mỗi Page một giao dịch, giới hạn kiểm trong giao dịch bằng khóa
tư vấn) → hết phiên thì `cleanup_connect_data` xóa hẳn. Kết nối lại (`reconnectConnectionId`) giữ nguyên `connectionId`.
Instagram: Page nguồn lưu ở `source_connection_id`; Page kết nối sau thì `confirm` gắn các Instagram đã có (`source_external_id`).

Ngắt: một giao dịch hủy lượt chưa gửi (cổng ngược `onDisconnect`) + xóa hai bản mã; thu hồi phía nền tảng SAU đó (≤ 5 giây, lỗi không
chặn). Meta chỉ thu hồi khi là kết nối Meta cuối cùng của tài khoản (quyền gắn với người dùng + ứng dụng).

## 5. Cổng ngược (`ConnectionConsumersPort`)

`publishing` đăng ký `scheduledImpact`, `onDisconnect`, `errorMappings` bằng `registerConnectionConsumers` (không import chéo).
Chưa đăng ký ⇒ bản rỗng: không bài, không hủy gì.

## 6. Việc nền (hàng chờ `scheduled`, chỉ Worker xử lý)

| Việc                                    | Lịch                                | Ghi chú                                                                                                                                   |
| --------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `platform_gateway.channel_maintenance`  | `0 20 * * *` UTC (03:00 UTC+7)      | gọi `list_due_connections` (SECURITY DEFINER, chỉ trả mã), tạo `check_connection` theo tài khoản, khóa `check_connection:{id}:{yyyymmdd}` |
| `platform_gateway.check_connection`     | tạo bởi việc trên                   | 8 bước ở `contracts/jobs-and-notifications.md`; gói hết hạn ⇒ 0 lời gọi nền tảng, 0 thông báo                                             |
| `platform_gateway.cleanup_connect_data` | `15 * * * *`                        | `purge_connect_data` (SECURITY DEFINER), lô ≤ 1000                                                                                        |
| `platform_gateway.disconnect_all`       | khi xóa tài khoản (FR-14 – chưa có) | idempotent; **điểm nối**: luồng xóa tài khoản tạo việc này với khóa `disconnect_all:{accountId}`                                          |

Hàng chờ `scheduled` có mặc định 0 lần thử lại (loại việc chỉ ghi đè THẤP hơn) nên các việc không tự thử lại trong ngày; kết nối chưa
kiểm tra được vẫn đến hạn ở lần quét kế tiếp. Nhắc hạn: mốc `d7 → d1 → expired` chỉ phát khi mốc > `last_notified_stage`, gom các
kênh cùng tài khoản cùng mốc thành MỘT thông báo (`connectionIds`).

Làm mới Meta: `adapter.renewToken` (đổi lại mã người dùng dài hạn bằng `fb_exchange_token`, lấy lại mã Page). Bật bằng
`META_TOKEN_REFRESH_ENABLED`. `renewToken` trả mã mới nên KHÔNG nằm trong `PlatformGateway` công khai.

## 7. Công tắc TikTok (`channel.tiktok`)

Giá trị hiệu lực = ghi đè của tài khoản ?? mặc định hệ thống (`gateway_settings`); lỗi đọc ⇒ TẮT. Chặn ở API (dịch vụ) **và** Worker;
`getAdapter('tiktok')` ở chế độ thật luôn trả `FeatureGuardedAdapter` nên không có đường tới `TiktokClient` mà không qua công tắc
(kiểm thử đếm lời gọi mạng = 0). Đổi công tắc: hàm SQL `set_feature_override` / `set_feature_default` (một giao dịch: ghi đè +
`feature_override_events` + `infra.audit_log` + `recheck_required`), gọi qua `PUT /staff/accounts/:id/features/channel.tiktok`,
`PUT /staff/features/channel.tiktok/default` (chỉ `admin`) hoặc `pnpm staff feature …`. TikTok chỉ kết nối/kiểm tra/làm mới/thu hồi;
đăng bài thật chưa hiện thực (`submit` ⇒ `user_action TT:POSTING_NOT_AVAILABLE`, không bao giờ `transient`).

## 8. Quyền và kiểm toán

`channel.view` = chủ + cộng tác viên; `channel.manage` = chỉ chủ; `feature.manage` = chỉ `admin`. Kiểm toán `infra.audit_log`:
`channel.connect|connect_failed|reconnect|recheck|disconnect|state_changed` (metadata chỉ `connection_id, channel_type, result,
reason_code, trace_id`); hỗ trợ xem kênh qua `support_channel_view` (không có cột bản mã) và ghi `support.view_channel`.

## 9. Cách thêm một nền tảng

1. Thêm loại vào `CHANNEL_TYPES` (`public-api.ts`) và `CONNECTABLE_CHANNEL_TYPES` (`@app/shared/platform_gateway`); CHECK ở bảng.
2. Viết bộ chuyển đổi `PlatformAdapter` (`authorizeUrl`, `exchangeCallback`, `checkAccount`, `expiryOf`, `renewToken?`, `revoke`…),
   bảng lỗi, máy khách HTTP bọc `fetch` (mã chỉ ở tiêu đề).
3. Đăng ký trong `platform_gateway.module.ts` (và bản giả ở `fake/channels.ts`). Nếu sau công tắc: bọc `guardAdapter`.
4. Thêm kiểm thử hợp đồng (mẫu `meta-check-account.contract.spec.ts`, `tiktok-adapter.contract.spec.ts`) và quét bí mật.
5. Web: thêm nhãn nền tảng (`channel-state.ts`) và chuỗi ở `lib/i18n/vi.ts`.

## 10. Biến môi trường chính

`FACEBOOK_APP_ID/SECRET`, `META_GRAPH_BASE_URL`, `META_TOKEN_REFRESH_ENABLED`, `CHANNEL_SCOPE_GROUPS`, `CHANNEL_SCOPES_*`,
`CREDENTIAL_VAULT_DRIVER`, `CREDENTIAL_MASTER_KEY_B64`, `KMS_KEY_ID`, `TIKTOK_CLIENT_KEY/SECRET`, `TIKTOK_BASE_URL`,
`TIKTOK_TIMEOUT_MS`, `CHANNEL_CONNECT_REDIRECT_BASE`, `PLATFORM_ADAPTER_MODE`, `PLATFORM_GATEWAY_DRIVER`.
