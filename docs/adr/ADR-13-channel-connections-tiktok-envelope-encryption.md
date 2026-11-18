# ADR-13: Kết nối kênh thật – TikTok vào giai đoạn 1 (dạng tắt), mã hóa phong bì, phụ thuộc `account`, nhóm quyền mở rộng

- **Trạng thái**: Đề xuất – chờ SA duyệt (mục 3.4 cần PO duyệt vì chạm Hiến pháp VII)
- **Ngày**: 2026-11-18
- **Tính năng**: `specs/010-connect-facebook-instagram` (FR-002, FR-006, FR-033, FR-043, R1, R2, R5)
- **Liên quan**: ADR-05 (bộ chuyển đổi nền tảng), ADR-09 (khóa ngoại chỉ trong module), ADR-10 (hạ tầng trong nước), ADR-12
  (cùng mẫu `X → account`); Hiến pháp I, IV, VII, IX
- **Ghi chú vị trí**: ADR-01…10 nằm trong `TaiLieuDacTa/`; ADR này đặt trong kho mã để review cùng mã (như ADR-11, ADR-12).

## 1. Bối cảnh

- 005 chỉ có luồng kết nối **giả lập**. 010 làm thật cho Facebook Page + Instagram chuyên nghiệp và chuẩn bị TikTok.
- ADR-05 ghi TikTok là "giai đoạn sau". PO (2026-11-17) muốn có sẵn bộ chuyển đổi TikTok để bật theo từng khách hàng,
  không phải phát hành lại khi TikTok duyệt ứng dụng.
- `FakeCredentialVault` của 005 không mã hóa thật; production cần mã hóa phong bì. KMS của nhà cung cấp trong nước (K5)
  chưa chốt (ADR-10 đang xác minh VNG Cloud).
- `platform_gateway` cần biết gói còn hiệu lực (FR-033: gói hết hạn thì dừng gọi nền tảng), nhưng gói thuộc module `account`.
- PO (2026-11-18, FR-043) muốn xin thêm nhóm quyền thống kê (`analytics`) và quảng cáo (`ads`) ngay từ lần cấp quyền đầu,
  để khách không phải cấp quyền lại khi các tính năng đó ra mắt – rộng hơn câu "quyền tối thiểu" của Hiến pháp VII.

## 2. Quyết định và phương án

### 2.1 TikTok trong giai đoạn 1

| Tiêu chí (trọng số)                        | A. Chờ giai đoạn sau | B. Có bộ chuyển đổi, **tắt mặc định**, bật theo khách | C. Bật cho mọi khách |
| ------------------------------------------ | -------------------- | ----------------------------------------------------- | -------------------- |
| Không phát hành lại khi TikTok duyệt (35%) | 1                    | 5                                                     | 5                    |
| Rủi ro lộ tính năng chưa duyệt (30%)       | 5                    | 4                                                     | 1                    |
| Chi phí thi công thêm (20%)                | 5                    | 3                                                     | 3                    |
| Phù hợp phạm vi giai đoạn 1 (15%)          | 5                    | 3                                                     | 2                    |
| **Tổng**                                   | 3,60                 | **4,00**                                              | 2,95                 |

**Chọn B.** Công tắc `channel.tiktok` theo tài khoản, mặc định tắt; chặn ở API **và** Worker; khi tắt thì 0 lời gọi tới TikTok.
Đảo ghi chú "giai đoạn sau" của ADR-05 chỉ cho phần **kết nối**; đăng bài TikTok vẫn là tính năng sau.

### 2.2 Mã hóa mã quyền

| Tiêu chí (trọng số)                         | A. Cột mã hóa bằng một khóa ứng dụng | B. Mã hóa phong bì + `KeyWrapper` | C. Gọi KMS cho từng bản ghi |
| ------------------------------------------- | ------------------------------------ | --------------------------------- | --------------------------- |
| Xoay khóa không phải mã hóa lại (30%)       | 1                                    | 5                                 | 3                           |
| Đổi nhà cung cấp KMS chỉ đổi cấu hình (25%) | 2                                    | 5                                 | 3                           |
| Độ trễ / số lời gọi KMS (20%)               | 5                                    | 4                                 | 1                           |
| Đơn giản (25%)                              | 5                                    | 3                                 | 3                           |
| **Tổng**                                    | 3,05                                 | **4,30**                          | 2,60                        |

**Chọn B.** DEK AES-256-GCM ngẫu nhiên cho từng bản ghi (`node:crypto`, không tự viết mật mã), **AAD = `accountId|purpose|refId`**
nên bản mã không dùng được nếu bị đem sang kết nối/tài khoản khác. DEK được bọc bởi giao diện `KeyWrapper`:
`kms` (chờ K5), `env-master-key` (khóa chủ 256 bit từ biến bí mật). Định dạng `v1 | keyId | wrappedDek | iv | tag | ciphertext`,
`keyId` cho phép xoay khóa. `env-master-key` **chỉ** dùng ở development/test và staging khi `STAGING_ALLOW_ENV_MASTER_KEY=true`;
production từ chối (kiểm bởi `assert-no-fakes`).

### 2.3 Phụ thuộc `platform_gateway → account`

Chọn cách đọc `AccountPublicApi.getPublishingEligibility()` (đã có từ ADR-12) thay vì chép dữ liệu gói hoặc đọc bảng của
`account`. Thêm `account` vào `allowedDeps` của `platform_gateway`; không tạo vòng (`account` không phụ thuộc gateway).
Chiều ngược (`publishing` cung cấp số bài đã lên lịch, hủy lượt khi ngắt) đi qua `ConnectionConsumersPort` do `publishing`
đăng ký lúc khởi động, để `platform_gateway` **không** import `publishing`.

### 2.4 Nhóm quyền Meta/TikTok

Xin ba nhóm `publish` + `analytics` + `ads` (cấu hình `CHANNEL_SCOPE_GROUPS`, đổi không cần sửa mã); nhóm `trends` **không** xin từ nền tảng.
010 **chỉ xin quyền, không gọi API thống kê/quảng cáo**; việc "quảng cáo chỉ ở dạng nháp chờ duyệt" do tính năng quảng cáo sau ép.
Đây là **mở rộng so với "quyền tối thiểu" của Hiến pháp VII**; được PO chấp nhận (2026-11-18) kèm điều kiện:

- hồ sơ đánh giá tác động chuyển dữ liệu xuyên biên giới (Q-D3/C6) ghi rõ Meta nhận thêm dữ liệu thống kê và TikTok là bên nhận mới;
- nếu Meta App Review từ chối `ads`/`analytics`, nộp lại chỉ với `publish` bằng cách đổi `CHANNEL_SCOPE_GROUPS=publish`;
- màn hình cấp quyền và màn hình "Kênh kết nối" nêu đúng những gì đã cấp, bằng lời thường.

## 3. Hệ quả

- Thêm 5 bảng tenant + 1 bảng dùng chung cho `platform_gateway`; chỉ mục duy nhất toàn cục `(channel_type, external_id)` là
  ngoại lệ có lý do của quy tắc "chỉ mục bắt đầu bằng `account_id`" (một Page chỉ thuộc một tài khoản, FR-006).
- Production bị chặn cho tới khi có KMS thật (K5); staging chạy với `env-master-key`.
- TikTok là bên nhận dữ liệu nước ngoài mới → phải ghi vào Kiến trúc dữ liệu mục 9 trước khi bật cho khách thử nghiệm.
- `ChannelConnection.status` công khai **giữ 4 giá trị** cũ; trạng thái phong phú là trường mới `state` (không phá 012/013).

## 4. Điều kiện xem xét lại

- Khi 007 chốt KMS của nhà cung cấp (cập nhật `kms.wrapper.ts`, bỏ `env-master-key` khỏi staging nếu có thể).
- Khi TikTok duyệt ứng dụng hoặc đổi chính sách quyền (xem lại 2.1).
- Khi Meta từ chối nhóm `ads`/`analytics` hoặc yêu cầu thu hẹp quyền (xem lại 2.4).
- Khi số kết nối vượt khả năng quét hằng ngày (500 kết nối/lô) – xem lại thiết kế việc nền.
