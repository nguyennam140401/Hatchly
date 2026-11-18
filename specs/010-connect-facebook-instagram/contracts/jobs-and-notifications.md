# Hợp đồng – việc nền, thông báo, kiểm toán, chỉ số (010)

Dùng lớp hàng chờ 003 (`defineJobType`, `defineSchedule`, `registerJobHandler`), hàng chờ `scheduled` (đã có). Đăng ký bộ xử lý **chỉ ở Worker**; khai báo loại việc dùng được ở cả API.
Phong bì việc mang `accountId`; payload **chỉ mã tham chiếu** (không mã quyền, không tên Page, không `code`).

## 1. Loại việc

| Tên | Phạm vi | Hàng chờ | Khóa chống trùng | Lịch/kích hoạt | Thử lại |
|---|---|---|---|---|---|
| `platform_gateway.channel_maintenance` | `system` | `scheduled` | `scheduled:channel_maintenance:{slot}` | cron `0 20 * * *` UTC (= 03:00 UTC+7), hằng ngày | lần chạy kế tiếp tự bù |
| `platform_gateway.check_connection` | `tenant` | `scheduled` | `check_connection:{connectionId}:{yyyymmdd}` (hằng ngày); `…:{connectionId}:recheck:{version}` khi do công tắc/gia hạn | tạo bởi `channel_maintenance` | 3 lần (1 → 5 → 15 phút) chỉ khi lỗi **hạ tầng của ta**; lỗi tạm thời của nền tảng = kết quả `deferred`, không thử lại trong ngày |
| `platform_gateway.cleanup_connect_data` | `system` | `scheduled` | `scheduled:cleanup_connect_data:{slot}` | cron `15 * * * *` (hằng giờ) | lần chạy kế tiếp tự bù |
| `platform_gateway.disconnect_all` | `tenant` | `scheduled` | `disconnect_all:{accountId}` | tạo bởi luồng xóa tài khoản (FR-14, tính năng khác) | 5 lần giãn cách tăng dần; idempotent |

Hạn thời gian khóa việc = mặc định hàng chờ `scheduled` (10 phút); `check_connection` dùng `signal` ≤ 10 giây cho mỗi lời gọi nền tảng.

### 1.1 `channel_maintenance` (system)

1. Gọi `platform_gateway.list_due_connections(batch_limit, now)` – hàm `SECURITY DEFINER` chỉ trả `(account_id, connection_id)`; **không** mã quyền, tên, token. Điều kiện "đến hạn":
   - `status='active'` và (`last_checked_at IS NULL` hoặc `last_checked_at < now - 20 giờ`), **hoặc**
   - `status='active'` và `token_expires_at IS NOT NULL AND token_expires_at < now + (warn_days + 1) ngày` (cần làm mới/nhắc), **hoặc**
   - `recheck_required = true` (kể cả `needs_reconnect`/`ineligible`, để tự phục hồi khi người dùng đã sửa phía nền tảng), **hoặc** TikTok có `last_checked_at < gateway_settings.updated_at` của `channel.tiktok.enabled_default`.
   `needs_reconnect` thuần (không `recheck_required`) **không** quét lại hằng ngày (người dùng phải kết nối lại; tránh gọi nền tảng vô ích).
2. Với mỗi dòng (tối đa `channel.check_batch_limit` = 500/lần chạy), tạo việc `check_connection` (cùng giao dịch hàng chờ, khóa chống trùng ở trên). Còn dư ⇒ lần chạy kế tiếp (không mất việc).

### 1.2 `check_connection` (tenant, chạy lại an toàn)

```
Đầu: đặt ngữ cảnh tenant từ phong bì (systemTx tenant=accountId).
1. Đọc kết nối (không giữ giao dịch lúc gọi nền tảng). Không có/đã ngắt → xong (no-op).
2. account.getPublishingEligibility(): planActive=false hoặc deletionRequested=true
      → đặt recheck_required=true (một lần, cập nhật có điều kiện); KHÔNG gọi nền tảng; KHÔNG nhắc. xong. (FR-033)
3. channel_type='tiktok' và requireFeature=false → bỏ qua (xong); (suspended – không gọi nền tảng) (FR-038)
4. Instagram có source_connection_id: nếu Page nguồn state ∉ {active, expiring} → xong (SOURCE_PAGE_LOST do dẫn xuất; không gọi nền tảng vô ích).
5. Giải mã (vault) → nếu capabilities.tokenRefresh và (hạn còn < warn_days + 1 ngày) → adapter.refreshToken; rồi adapter.checkAccount (+ adapter.expiryOf để đo lại hạn).
6. Ghi kết quả bằng UPDATE … WHERE id=:id AND version=:v (một giao dịch, cùng giao dịch phát thông báo):
   • refreshed        → token_ciphertext/refresh_ciphertext mới, token_issued_at=now, hạn mới, last_refreshed_at; không thông báo.
   • eligible         → last_checked_at=now, last_error_code=NULL, cập nhật account_type/scopes/quota/hạn; recheck_required=false;
                        nếu trước đó ineligible/needs_reconnect do kiểm tra → active.
   • ineligible/revoked (khẳng định) → status='needs_reconnect'|'ineligible' + reason_code; thông báo channel_needs_reconnect (gom).
   • transient/unknown (mạng, 5xx, mã lạ) → chỉ ghi last_error_code; KHÔNG đổi status, KHÔNG cập nhật last_checked_at
                        (để lần quét sau tự thử lại) (FR-012). Quá hạn thật (token_expires_at <= now) vẫn đi nhánh "expired" ở bước 7.
7. Nhắc hạn (chỉ khi active và còn < warn_days và làm mới KHÔNG thành công):
      stage = d7 (lần đầu vào cửa sổ) → d1 (còn ≤ 1 ngày) → expired (đã quá hạn → cũng chuyển needs_reconnect, reason TOKEN_EXPIRED).
      Chỉ phát khi stage > last_notified_stage (cập nhật có điều kiện) → không gửi hằng ngày.
8. Mất cập nhật do đua (0 dòng): đọc lại; nếu bản ghi đã có token_issued_at mới hơn bản vừa làm mới → bỏ kết quả của ta (không ghi đè quyền mới bằng quyền cũ).
```

Chạy lại hai lần ⇒ cùng kết quả: bước 6 so `version`; bước 7 so `last_notified_stage`; thông báo có khóa chống trùng (mục 2); làm mới lần hai thấy hạn mới nên không làm lại.
Hai Worker cùng lấy: khóa chống trùng của hàng chờ + `version`. Worker chết giữa chừng: khóa việc hết hạn ⇒ chạy lại từ đầu an toàn.

### 1.3 `cleanup_connect_data`

`DELETE FROM connect_states WHERE used_at IS NOT NULL OR expires_at < now() - interval '1 hour'` và tương tự `connect_selections` (xóa **hẳn**, kể cả mã quyền đã mã hóa của ứng viên). Idempotent. Chạy trong `systemTx` theo lô (≤ 1000 dòng/lần).

### 1.4 `disconnect_all`

Trong `tenantTx`: với mỗi kết nối chưa ngắt: giải mã → `status='disconnected'`, `*_ciphertext=NULL`, `onDisconnect` → thu hồi (≤ 5 giây, lỗi không chặn) → kiểm toán `channel.disconnect` (`reason: account_deletion`). Gọi lại ⇒ không còn gì để làm. Kiểm thử gọi trực tiếp (luồng xóa tài khoản chưa có).

## 2. Thông báo (mở rộng danh mục đóng của 005 – `packages/shared/src/modules/notifications/events.ts`)

| Loại | Người nhận | Kênh | Gộp email | Hành động | Ghi chú |
|---|---|---|---|---|---|
| `channel_token_expiring` *(đã có – mở rộng)* | chủ | trong ứng dụng + email | ngay (`immediate`) | `reconnect_channel` | `refs` thêm tùy chọn `stage: 'd7'|'d1'|'expired'`, `connectionIds?: uuid[] (≤ 10)`; sự kiện cũ (không `stage`) vẫn hợp lệ |
| `channel_needs_reconnect` **(mới)** | chủ | trong ứng dụng + email | ngay | `reconnect_channel` | `refs: { connectionId, connectionIds?: uuid[], reason: 'token_expired'|'token_revoked'|'scope_missing'|'source_page_lost'|'not_eligible' }`; `params: { channelDisplayName?, affectedPosts?: int }` |

- **Gộp theo đợt (FR-035)**: một lần chạy `channel_maintenance` gộp các kết nối cùng tài khoản cùng `stage` thành **một** sự kiện (`connectionIds`); `params.channelDisplayName` là tên kênh đầu + "và N kênh khác" (≤ 120 ký tự).
- **Instagram phụ thuộc Page (FR-042)**: khi Page chuyển `needs_reconnect`/`disconnected`, một sự kiện **gộp cả hai kênh** (`connectionIds=[Page, IG…]`, `reason: 'source_page_lost'` cho IG).
- **Số bài bị ảnh hưởng (FR-021)**: lấy từ `ConnectionConsumersPort.scheduledImpact` lúc phát; chỉ là **số nguyên** hiển thị (không nội dung bài, **không** số tiền).
- **Khóa chống trùng** (do máy chủ dựng, `dedupe-keys.ts`): `channel_token_expiring:{connectionId}:{expiresOn}:{stage}`; `channel_needs_reconnect:{connectionId}:{reason}:{ngày UTC}`. Phát bằng `notifications.emit(tx, …)` **trong cùng giao dịch** ghi trạng thái (nguyên tắc IV): giao dịch hủy ⇒ không có thông báo.
- **Không** gửi hằng ngày: mốc d7 → d1 → expired (FR-020); nhiều kênh cùng hết hạn một ngày = một email (Edge Case).
- Nội dung (tiếng Việt đời thường, không bí mật): "Quyền Facebook của bạn sẽ hết hạn ngày …, hãy kết nối lại" + nút "Kết nối lại" (`/channels`). Không số tiền AI, không mã lỗi gốc.

## 3. Kiểm toán (`infra.audit_log`, 12 tháng; **không** mã quyền/dữ liệu cá nhân dư thừa – FR-030)

| Hành động | Khi nào | Metadata |
|---|---|---|
| `channel.connect` / `channel.connect_failed` | `confirm` từng ứng viên | `connection_id`, `channel_type`, `result`, `reason_code`, `trace_id` |
| `channel.reconnect` | kết nối lại thành công/thất bại | như trên |
| `channel.recheck` | "Kiểm tra lại" | + `outcome` |
| `channel.disconnect` | ngắt | + `revoked`, `cancelled_attempts`, `reason` (`user`\|`account_deletion`) |
| `channel.state_changed` | job/`reportAuthFailure` đổi trạng thái lưu | `from`, `to`, `reason_code` |
| `feature.set` | đổi công tắc | `flag`, `old`, `new` (+ `feature_override_events`) |
| `support.view_channel` | hỗ trợ xem kênh của khách | `connection_id` |

Nhật ký kỹ thuật tách khỏi nhật ký nghiệp vụ; log có cấu trúc luôn có `trace_id`, `account_id`; URL ra ngoài đã che tham số nhạy cảm; trường tên Page **không** vào log.

## 4. Chỉ số & cảnh báo (OpenTelemetry – Hiến pháp VIII)

| Chỉ số | Nhãn | Dùng cho |
|---|---|---|
| `channel_connections` (gauge, quét định kỳ qua hàm tổng hợp **không** mã tài khoản) | `state`, `channel_type` | số kênh theo trạng thái (FR-031) |
| `channel_expiring_lt7d` (gauge) | `channel_type` | cảnh báo vận hành "quyền còn < 7 ngày" (chung ngưỡng nhắc) |
| `channel_refresh_total` (counter) | `channel_type`, `result` (`ok`/`deferred`/`failed`) | tỷ lệ làm mới thành công (SC-005) |
| `channel_connect_total` (counter) | `channel_type`, `result` | tỷ lệ kết nối thành công/nguyên nhân thất bại |
| `channel_feature_read_failed_total` | — | công tắc không đọc được (phải ≈ 0) |

Hàm tổng hợp `platform_gateway.channel_stats()` (`SECURITY DEFINER`, chỉ trả số đếm theo `state × type`) – cùng mẫu `publishing.sweep_stats` của 013 nên không vi phạm cô lập tenant.
Cảnh báo: tỷ lệ làm mới lỗi > 5%/giờ; `channel_feature_read_failed_total` > 0 kéo dài 10 phút.

## 5. Kiểm thử bắt buộc (Hiến pháp "Kiểm thử bắt buộc theo vùng rủi ro")

1. **Chạy lại hai lần** (`expectIdempotent`) cho `check_connection`, `cleanup_connect_data`, `disconnect_all`.
2. Hai Worker cùng lấy một `check_connection` ⇒ một kết quả, một thông báo (`startTestWorkers(2)`).
3. Worker chết giữa chừng sau khi làm mới nhưng trước khi ghi ⇒ chạy lại không mất kết nối, không ghi đè quyền mới.
4. Đua: Worker làm mới × người dùng kết nối lại ⇒ quyền mới hơn (`token_issued_at`) thắng.
5. Đồng hồ giả: hết hạn sau 10 ngày làm mới được; đặt làm mới lỗi khi còn 6 ngày ⇒ đúng 1 thông báo + 1 email (`d7`), còn 1 ngày ⇒ thêm 1 (`d1`), hết hạn ⇒ `needs_reconnect` + 1 (`expired`); kết nối lại ⇒ `active`, cảnh báo biến mất (SC-005/006).
6. Gói hết hạn ⇒ 0 lời gọi nền tảng, 0 thông báo; gia hạn ⇒ lần chạy kế tiếp kiểm tra lại từng kết nối độc lập (US7-7).
7. Lỗi tạm thời ⇒ trạng thái không đổi (FR-012); mã lạ ⇒ `unknown` không đổi trạng thái.
8. Ngày 29–31/tháng ngắn không liên quan trực tiếp (chu kỳ gói thuộc `account`) – chỉ kiểm cách tính `daysLeft` theo UTC+7.
