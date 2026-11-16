# Hợp đồng: bộ chuyển đổi Facebook Page và Instagram (bổ sung cho 005)

Không đổi giao diện chung `PlatformAdapter`/`PlatformGatewayPublicApi` của 005. 013 **hiện thực** thêm hai bộ chuyển đổi thật; phần
OAuth/`checkAccount`/`refreshToken` thuộc 010 (nếu 010 chưa xong thì để bản giả lập ở các thao tác đó).

## 1. Khai báo năng lực

| Kênh | `reconcile` | `asyncProcessing` | `tokenRefresh` | `reportsQuota` | `maxReconcileWindowHours` |
|---|---|---|---|---|---|
| `facebook_page` | **cấu hình** (mặc định `false` đến khi POC-2 xác nhận) | `false` | theo 010 | `false` | 24 |
| `instagram` | **cấu hình** (mặc định `false`) | `true` | theo 010 | `true` (hạn mức 24 giờ) | 24 |

`reconcile = false` ⇒ `reconcile()` luôn `unsupported` ⇒ lượt đăng `unknown` đi thẳng `needs_check` (R5, hướng an toàn).

## 2. Quy tắc media (`mediaRules()`)

Số liệu là **cấu hình**, đọc từ bảng quy tắc của bộ chuyển đổi, không hằng số rải trong luồng đăng.

| Kênh | Chữ | Ảnh | Video |
|---|---|---|---|
| Facebook | có, ≤ `MAX_POST_TEXT_LENGTH` | nhiều ảnh (≤ `maxItems`) | **một** video; `maxBytes` đặt 1 GB theo PO (Clarifications 2026-11-16), kiểm lại bằng POC-2 |
| Instagram | **không** (bài phải có media) | JPEG, tỉ lệ trong khoảng cho phép; nhiều ảnh = carousel | một video; giới hạn thời lượng/dung lượng theo `mediaRules()` |

`allowMixed = false` ở cả hai (không trộn ảnh và video trong một bài).

## 3. Chuẩn hóa mã lỗi gốc

`rawCode` = `<NỀN TẢNG>:<mã>[:<mã phụ>]` đã lọc `[A-Za-z0-9_.:-]{1,64}`, ví dụ `FB:190`, `FB:368`, `IG:9007`, `HTTP:503`,
`NET:TIMEOUT_AFTER_SEND`, `NET:CONNECT_REFUSED`. Quy tắc phân loại bắt buộc:

| Tình huống | Loại | Lý do |
|---|---|---|
| Lỗi mạng **trước** khi gửi được yêu cầu (từ chối kết nối, DNS) | `transient` | chắc chắn chưa tới nền tảng |
| Hết thời gian chờ / mất kết nối **sau** khi đã gửi | `unknown` | không biết nền tảng đã nhận chưa |
| HTTP 5xx **chung chung** từ nền tảng khi `submit` | `unknown` | nền tảng có thể đã tạo bài rồi mới lỗi |
| Mã "quá tải/tạm thời không xử lý" mà nền tảng ghi rõ là từ chối trước khi tạo bài (đã có dòng trong bảng, đã kiểm thử hợp đồng) | `transient` | đáp ứng ví dụ "nền tảng quá tải" của spec US3-1 |
| HTTP 429 / mã giới hạn tốc độ có phản hồi từ nền tảng | `transient` (kèm `retryAfterSec` nếu có) | nền tảng từ chối chắc chắn |
| Mã hết hạn/thu hồi quyền, thiếu quyền | `user_action` (`reconnect`) | |
| Không phải tài khoản chuyên nghiệp (Instagram) | `user_action` | |
| Ảnh/video sai định dạng, quá cỡ | `user_action` (`edit_media`) | |
| Hạn mức bài/24 giờ | `user_action` (đổi giờ) | |
| **Mã chưa có trong bảng** | `unknown` | không bao giờ đoán là `transient` |

> 5xx của nền tảng ở `submit` xếp `unknown` (không phải `transient`) — khác ví dụ "quá tải, thử lại sau" ở ADD vì không có bằng
> chứng nền tảng chưa tạo bài. Chỉ mã **được ghi rõ** là từ chối trước khi xử lý (bảng lỗi đã kiểm thử) mới là `transient`.
> Ghi vào ADR-04 như một làm rõ.

## 4. Kiểm thử hợp đồng chung (`apps/server/test/platform-gateway/adapter-contract.spec.ts`)

Cùng một bộ ca chạy cho `FakeAdapter`, `FacebookAdapter`, `InstagramAdapter` (với máy chủ Graph giả `graph-stub`):

1. `submit` thành công → `published` (Facebook) / `processing` rồi `checkStatus` → `done` (Instagram).
2. `submit` hết thời gian sau khi gửi → `failed.error.category = 'unknown'`.
3. `submit` bị từ chối trước khi gửi → `transient`.
4. Mã giới hạn tốc độ → `transient` có `retryAfterSec`.
5. Mã quyền hết hạn → `user_action` + remedy `reconnect`.
6. Mã lạ → `unknown`.
7. `reconcile` với bài đã có → `found`; chưa có → `not_found`; năng lực tắt → `unsupported`.
8. `contentHash` ổn định qua chuẩn hóa Unicode/khoảng trắng (cùng quy tắc ở gửi và đối soát).
9. Mã quyền **không** xuất hiện trong URL, log, thông điệp lỗi, `ClassifiedError` (quét chuỗi mẫu).
10. `checkAccount` Instagram không chuyên nghiệp → `ineligible` + remedy.

## 5. Bảng ánh xạ lỗi ban đầu

Nạp vào `publishing.error_mappings` bằng migration (dữ liệu, không mã): tối thiểu các dòng ADD mục 7 (quyền hết hạn, thiếu quyền, không
chuyên nghiệp, ảnh sai định dạng, hạn mức 24 giờ, giới hạn tốc độ, quá tải nền tảng, hết thời gian chờ) cho mỗi kênh; hoàn thiện sau POC-2.
