# Hợp đồng – công tắc tính năng TikTok (FR-036…FR-039)

Chỉ một khóa ở giai đoạn 1: `channel.tiktok`. Cơ chế "khóa → giá trị" đủ chung để thêm khóa khác sau mà không làm lại (Assumptions), nhưng **không** mở rộng sớm
(danh sách khóa hợp lệ nằm ở một hằng số + CHECK của bảng; thêm khóa = một thay đổi có chủ đích).

## 1. Quy tắc tính giá trị (hàm thuần `resolveFlag`, có kiểm thử bảng)

| Ghi đè theo tài khoản | Mặc định hệ thống | Kết quả `enabled` |
|---|---|---|
| `on` | bất kỳ | **true** |
| `off` | bất kỳ | **false** (ghi đè tắt luôn thắng) |
| không có dòng ("theo mặc định") | `true` | **true** |
| không có dòng | `false` | **false** |
| *bất kỳ* | *không đọc được* (lỗi CSDL/cấu hình hỏng) | **false** + log `feature.read_failed` (FR-038) |

Giá trị khởi tạo của mặc định: `false` (migration nạp `gateway_settings`).

## 2. Hiệu lực ≤ 1 phút, không cần phát hành (SC-011, SC-012)

- `FeatureGate` giữ cache trong tiến trình theo `(accountId, flag)` với TTL **≤ 60 giây** (cấu hình tối đa 60; mặc định 30), và cache `default` TTL ≤ 60 giây. Đây không thuộc nhóm "cấm cache" (không phải ngân sách/hạn mức/trạng thái đăng/quyền nền tảng).
- Bản xử lý yêu cầu đổi cấu hình xóa cache của `(account, flag)` ngay; các bản khác chờ hết TTL. Lỗi đọc **không** được cache lâu (TTL lỗi 5 giây) để phục hồi nhanh.
- Đổi mặc định hệ thống chỉ là cập nhật một dòng `gateway_settings` (SC-012: bật cho toàn bộ khách khi TikTok duyệt, không phát hành).

## 3. Chặn ở API **và** Worker (FR-038, SC-011)

`requireFeature(flag)` là một hàm của `platform_gateway` gọi **trước khi chạm adapter** ở các điểm: `startConnect`, `handleCallback`, `confirm`, `recheck`, `check_connection` (Worker), mọi thao tác `PlatformGatewayService` với `channelType='tiktok'` (`checkAccount`, `refreshToken`, `submit`…).
Không có đường nào tới `TiktokClient` mà không qua `requireFeature` — bảo đảm bằng **kiểm thử cấu trúc**: bộ chuyển đổi TikTok chỉ được tạo qua `FeatureGuardedAdapter` (decorator) và `getAdapter('tiktok')` ở `real` trả decorator; kiểm thử đếm lời gọi mạng trên máy chủ giả = 0 khi tắt.

Giao diện: `overview.features.tiktok=false` ⇒ không vẽ thẻ/nút/bộ lọc/văn bản TikTok (trừ kết nối đã có – xem mục 4); bộ chọn kênh của 012 không bao giờ có `tiktok` (R3).

## 4. Chuyển bật → tắt → bật (FR-039)

| Thời điểm | Hành vi |
|---|---|
| Tắt | `state` dẫn xuất = `suspended` (`FEATURE_OFF`) cho mọi kết nối TikTok của tài khoản; `status` công khai = `disconnected` ⇒ 012/013 coi là không dùng được; **giữ** mã quyền (mã hóa); Worker không làm mới/kiểm tra; giao diện hiện duy nhất để **xem và ngắt** (chú thích "Tính năng đang tạm tắt"); bài đã lên lịch đến giờ ⇒ 013 `precheck` thấy `disconnected` ⇒ lỗi cần người dùng, **không gửi** |
| Lượt đang xử lý lúc tắt | để chạy xong theo luồng thường (không bỏ giữa chừng – Edge Case); từ lượt kế tiếp bị chặn |
| Bật lại | `recheck_required=true` cho mọi kết nối TikTok của tài khoản (đặt trong **cùng giao dịch** đổi ghi đè; đổi **mặc định** thì `list_due_connections` coi kết nối TikTok có `last_checked_at < gateway_settings.updated_at` là cần kiểm tra lại); việc `check_connection` kế tiếp kiểm tra lại điều kiện và đặt trạng thái đúng (hết hạn ⇒ `needs_reconnect`); bài đã lên lịch dùng lại được qua "Đăng lại" (013) |

## 5. Ai được đổi, và kiểm toán (FR-037)

- Mã quyền `feature.manage`: **chỉ `admin`** (`PERMISSIONS`: owner/collaborator/support = false). Chủ không có cách tự bật (FR-038 kịch bản 8). Kiểm tra ở API bằng `@StaffAccess('feature.manage')`.
- `features.service.set(...)` trong **một giao dịch**: (1) upsert/xóa `feature_overrides` (hoặc cập nhật `gateway_settings`), (2) chèn `feature_override_events` (ai, tài khoản, cũ → mới, lý do bắt buộc 1–500 ký tự, `trace_id`), (3) ghi `infra.audit_log` `feature.set` (metadata: `flag`, `old`, `new`, `reason_len` – **không** chép lại lý do dài nếu chứa dữ liệu cá nhân; lý do đầy đủ nằm ở `feature_override_events` giữ 12 tháng), (4) nếu đổi ghi đè: `recheck_required=true` cho kết nối TikTok của tài khoản đó, (5) xóa cache cục bộ.
- Ghi đè tài khoản dùng `systemTx({ tenant: accountId })` (vai trò `system` đặt được ngữ cảnh tenant một tài khoản – 002), **không** `BYPASSRLS`. `accountId` nhận từ đường dẫn **chỉ** ở điểm cuối nhân viên (mẫu `supportViewAccount` của 004).
- Lệnh nội bộ: `pnpm staff feature get|set-default|set <accountId> --reason "…"` bọc cùng `features.service` (cùng kiểm toán); phiên nhân viên/`actor` bắt buộc – không có đường "chạy thẳng SQL" được tài liệu hóa.

## 6. Kiểm thử bắt buộc

1. Bảng `resolveFlag` (6 tổ hợp + lỗi đọc).
2. Khách A tắt/B bật: A không thấy TikTok ở overview, gọi `connect/confirm/recheck` ⇒ `403 FEATURE_NOT_ENABLED`; **0 lời gọi mạng** (đếm máy chủ giả) kể cả Worker `check_connection`.
3. Bật cho A ⇒ ≤ 1 phút (đồng hồ giả) A kết nối được, B vẫn không thấy; tắt lại ⇒ kết nối của A `suspended`, ngắt được, mã quyền còn mã hóa.
4. Đổi mặc định `true` ⇒ khách không có ghi đè thấy TikTok; khách ghi đè `off` vẫn không thấy.
5. Chủ/CTV/`support` gọi `PUT` ⇒ 403; thiếu `reason` ⇒ 422; mỗi lần đổi có đúng 1 dòng `feature_override_events` + 1 dòng `audit_log`.
6. Lỗi đọc cấu hình ⇒ `enabled=false`, màn hình Facebook/Instagram vẫn hiển thị bình thường.
7. Truy cập chéo: A không đọc/sửa `feature_overrides`/`feature_override_events` của B.
