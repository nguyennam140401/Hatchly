# ADR-12: Đăng bài phụ thuộc module Tài khoản (kiểm tra gói) và ranh giới 012 ↔ 013

- **Trạng thái**: Đề xuất – chờ SA duyệt trước khi merge nhánh `impl/013-publish-five-steps`
- **Ngày**: 2026-11-16
- **Tính năng**: `specs/013-publish-five-steps` (FR-013, R15 của research.md)
- **Liên quan**: ADR-04 (đăng bài tin cậy, đối soát), ADR-05 (bộ chuyển đổi nền tảng), ADR-09 (khóa ngoại chỉ trong module);
  hiến pháp nguyên tắc II, IV, IX
- **Ghi chú vị trí**: ADR-01…10 nằm trong `TaiLieuDacTa/`; ADR này đặt trong kho mã để review cùng mã (như ADR-11).

## 1. Bối cảnh

- Bước 1 "kiểm tra trước" của lượt đăng (FR-013) phải biết gói còn hiệu lực và tài khoản có đang bị xóa hay không. Chỉ
  module `account` sở hữu dữ liệu này. Tệp kê khai hiện cho `publishing` phụ thuộc `content`, `media`, `platform_gateway`,
  `notifications`, `queue` – chưa có `account`.
- 012 đã dựng sẵn module `publishing` (bảng `publish_attempts`, giao diện `PublishingPublicApi`, loại việc
  `publishing.run_attempt`, bộ thực thi tạm). 013 thay phần thực thi 5 bước và mở rộng bảng bằng migration chỉ thêm.
- ADR-04 nói lỗi "không xác định" phải đối soát; thực tế mọi HTTP 5xx chung chung khi gửi bài có thể đã được nền tảng nhận.

## 2. Phương án

| #   | Phương án                                                                                         | Nhận xét                                                               |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A   | `publishing` gọi `AccountPublicApi.getPublishingEligibility()` (thêm `account` vào `allowedDeps`) | Đúng ranh giới module, một lời gọi nhẹ, không chép dữ liệu gói         |
| B   | `approval` kiểm gói rồi truyền vào lúc lên lịch                                                   | Gói có thể hết hạn **sau** khi lên lịch; bước 1 phải kiểm lại lúc đăng |
| C   | `publishing` đọc thẳng bảng `account`                                                             | Vi phạm hiến pháp IV / ADR-09                                          |

| Tiêu chí                   | Trọng số | A       | B       | C       |
| -------------------------- | -------- | ------- | ------- | ------- |
| Giữ ranh giới module       | 35%      | 5       | 4       | 1       |
| Đúng lúc đăng (không lệch) | 35%      | 5       | 2       | 5       |
| Đơn giản                   | 30%      | 4       | 3       | 5       |
| **Tổng**                   |          | **4,7** | **3,0** | **3,6** |

## 3. Quyết định

1. **Chọn A**: thêm `account` vào `allowedDeps` của `publishing`; `account` thêm hàm
   `getPublishingEligibility(): Promise<{ planActive: boolean; deletionRequested: boolean }>` (đọc trong `tenantTx`, không cache).
2. **Ranh giới 012 ↔ 013**: giữ nguyên tên loại việc `publishing.run_attempt`, payload `{ attemptId }`, khóa chống trùng
   `publish:{attemptId}`, các cột và CHECK của `publish_attempts` đã có (`channel_connection_id`, `content_version`), và
   `PublishingPublicApi` của 012. 013 chỉ **thêm** cột/bảng/hàm; không đổi nghĩa phần đã có (đáp ứng "API và Worker
   cũ/mới chạy song song"). Các tên `execute_attempt`, `connection_id`, `variant_version` trong tasks.md được đọc là các tên
   đã có này.
3. **Làm rõ ADR-04**: khi `submit` nhận HTTP 5xx chung chung hoặc hết thời gian sau khi đã gửi → loại `unknown` (đối soát,
   không gửi lại ngay). Chỉ mã quá tải được nền tảng ghi rõ và đã qua kiểm thử hợp đồng mới là `transient`. Mã lạ luôn `unknown`.

## 4. Hệ quả

- `publishing → account` thêm một cạnh phụ thuộc; `pnpm check:boundaries` vẫn phải đạt (không vòng).
- Gói hết hạn sau khi lên lịch → lượt đăng dừng ở `needs_user` (lý do `plan_expired`) thay vì đăng nhầm.
- Hàm đọc điều kiện không cache nên mỗi lượt đăng thêm một truy vấn nhỏ.

## 5. Điều kiện xem xét lại

- Khi `account` đổi mô hình gói (nhiều bậc) mà `planActive` không đủ biểu đạt.
- Khi tỷ lệ "Cần kiểm tra" > 1%/kênh/ngày hoặc `reconcile unsupported` > 20% (xem lại ADR-04).
