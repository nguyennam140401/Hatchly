# Quickstart – kiểm chứng Đăng bài 5 bước

Mục tiêu: chứng minh tính năng chạy đầu-cuối với bản giả lập của 005 trước, rồi (khi có tài khoản thử của Meta) với bộ chuyển đổi thật.
Chi tiết cấu trúc xem [data-model.md](./data-model.md); hợp đồng xem [contracts/](./contracts/). Không dán mã triển khai ở đây.

## 0. Điều kiện

- PostgreSQL phát triển chạy (`docker compose up` ở **một** checkout – trùng cổng 3000/3001/8080).
- Đã cài phụ thuộc (`pnpm install`) và áp dụng migration (`pnpm db:migrate`; cần vai trò `owner`).
- `PLATFORM_ADAPTER_MODE=fake` (mặc định ở dev/test).
- Có tài khoản mẫu và hai kênh giả (Facebook, Instagram) – dùng `pnpm dev:seed-auth` rồi kết nối kênh giả qua màn hình Kênh kết nối.

## 1. Kiểm thử tự động (cổng chất lượng)

| Việc | Lệnh |
|---|---|
| Kiểu + lint | `pnpm typecheck` · `pnpm lint` |
| Ranh giới module (kể cả `publishing → account` mới) | `pnpm check:boundaries` |
| Quy ước CSDL (RLS, `account_id`, phân vùng, bất biến nhật ký) | `pnpm db:check` · `pnpm db:immutable` |
| Tương thích ngược migration | `pnpm db:lint-migrations` · `pnpm db:compat` |
| Đơn vị + CSDL | `pnpm test` · `pnpm test:db` |
| Hàng chờ, hai Worker, Worker chết | `pnpm test:queue` |
| Hợp đồng bộ chuyển đổi (Facebook, Instagram, giả lập) | `pnpm test -- adapter-contract` |
| Truy cập chéo mọi bảng mới | `pnpm test:db -- publishing.cross-tenant` |
| Quét bí mật | `pnpm check:secrets` |
| Wiki | `pnpm wiki:check` |

Phải đạt toàn bộ trước khi `/speckit-implement` kết thúc. (Lệnh đã đối chiếu với `package.json` gốc; tổng hợp có thể chạy bằng `pnpm verify`.)

## 2. Kịch bản kiểm chứng bằng tay (bản giả lập)

Mỗi kịch bản dùng `/dev/fakes/scenarios` của bản giả lập để ép phản ứng của "nền tảng".

| # | Kịch bản | Cách làm | Kết quả mong đợi (liên hệ spec) |
|---|---|---|---|
| S1 | Đăng đúng giờ hai kênh | Lên lịch bài FB + IG sau 6 phút | Cả hai `Đã đăng`, có đường dẫn, mỗi lượt đủ 5 bước (US1) |
| S2 | Bấm duyệt hai lần | Gọi `schedule` hai lần cùng bài | Một lượt duy nhất mỗi kênh (US2-1) |
| S3 | Hai Worker | `startTestWorkers(2)`, 1 lượt | Chỉ một gửi; nền tảng giả có 1 bài (US2-2, SC-001) |
| S4 | Worker chết sau ghi dấu | Tắt Worker ngay sau ghi `submitted_awaiting_response` | Sau khi chạy lại: đối soát, **không gửi lại** (US2-3) |
| S5 | Lỗi tạm thời | Kịch bản `timeout_before_publish` ×2 rồi `published` | `Đang đăng` trên UI, không thông báo; cuối cùng `Đã đăng` (US3-1) |
| S6 | Hết lượt thử lại | Lỗi `transient` liên tục | Sau 5 lần/30 phút → `Cần bạn xử lý` + thông báo + email gộp (US3-2) |
| S7 | Lỗi cần người dùng | Mã quyền hết hạn | Dừng ngay, thông báo có "Kết nối lại" (US3-3) |
| S8 | Mã lỗi lạ | `{ fail: "ZZZ:1" }` | `unknown`, không gửi lại (US3-5) |
| S9 | Hết thời gian sau khi đã đăng | `timeout_after_publish`, đối soát được | Sau ~2 phút `Đã đăng` nhờ đối soát, 1 bài (US4-2) |
| S10 | Không thấy sau 10 phút | `timeout_before_publish` + `not_found` | Thử lại đúng 1 lần rồi `Đã đăng`/`Cần kiểm tra` (US4-3) |
| S11 | Kênh không đối soát được | `reconcile: unsupported` | `Cần kiểm tra` ngay + hai nút (US4-4) |
| S12 | "Đã đăng" / "Đăng lại" | Bấm lần lượt trên hai bài | Đóng thành công / về `Chờ đến giờ`, có nhật ký người thao tác (US4-5, US2-5) |
| S13 | Đăng lại theo kênh | Bài hai kênh, FB `Đã đăng`, IG lỗi | Chỉ IG có nút "Đăng lại"; gọi API cho FB → `PUBLISH_NOT_REPUBLISHABLE` (Clarifications) |
| S14 | Trễ quá 60 phút | Dừng Worker 61 phút (đặt giờ máy CSDL/chỉnh `scheduled_at`) rồi bật | Không đăng; `Cần bạn xử lý` "Bài đã quá giờ hẹn" (US7-6) |
| S15 | Đổi giờ khi Worker vừa nhận | `reschedule` khi một lượt `processing` | Từ chối, giờ cũ giữ nguyên (US7-2) |
| S16 | Instagram chỉ chữ | Bài IG không media | Chặn ở bước 1 với thông báo rõ (US6-3) |
| S17 | Màn hình 360 px | Mở Tiến trình đăng bằng chế độ điện thoại | Dòng thời gian dọc, vùng chạm ≥ 44 px, chữ + biểu tượng (US5-7) |
| S18 | Quét mã quyền | Chạy bộ ca hợp đồng với mã quyền mẫu | Không có ở log/bước/thông báo/phản hồi (SC-008) |
| S19 | AI bị khóa | Đặt ngân sách AI = 100% | Đăng, thử lại, đối soát, đăng lại vẫn chạy (SC-012) |

## 3. Kiểm chứng với nền tảng thật (sau 010 và có tài khoản thử của Meta)

1. Đặt `PLATFORM_ADAPTER_MODE=real` cho `facebook_page` (staging). Kết nối một Page thử qua 010.
2. Lên lịch bài chữ + ảnh; xác nhận bài lên Page, đường dẫn đúng, đủ 5 bước.
3. Tắt Worker giữa lúc gửi (chỉ trên Page thử) → xác nhận đối soát; **ghi lại** có đọc được bài đã đăng không (đầu vào POC-2).
4. Lặp với Instagram chuyên nghiệp (ảnh, carousel, video) → ghi thời gian xử lý, hạn mức 24 giờ.
5. Cập nhật `error_mappings`, năng lực `reconcile` và giới hạn video 1 GB theo kết quả; ghi ở `docs/wiki/open-questions.md` (POC-2).

## 4. Dọn dẹp

Dừng Worker giả và `docker compose` ở checkout này trước khi mở checkout khác (trùng cổng). Dữ liệu thử nằm trong CSDL phát triển; không có lệnh reset riêng – tạo lại bằng `pnpm db:setup` nếu cần.
