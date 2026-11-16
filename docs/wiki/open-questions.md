---
type: open-questions
title: Việc còn mở và giả định chưa kiểm chứng
sources:
  [
    .specify/memory/architecture.md,
    .specify/memory/constitution.md,
    infra/docs/p6-cau-hoi-nha-cung-cap.md,
  ]
updated: 2026-11-14
status: current
related: [decisions/index.md]
---

# Việc còn mở

Tóm tắt mục 12 của `.specify/memory/architecture.md`; khi lint wiki phát hiện việc mới, ghi thêm ở đây.

| Mã               | Nội dung                                                                                                                                                                                                       | Ảnh hưởng                                               | Mốc                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------- |
| T4               | Nhà cung cấp đám mây VNG Cloud; còn các điểm xác minh P6 V1–V14 (V2/V4/V9 chặn) — `infra/docs/p6-cau-hoi-nha-cung-cap.md`                                                                                      | Cấu hình                                                | Trước khi đưa dữ liệu thật         |
| T4c              | CSDL CloudNativePG, chuyển `managed` khi V1 đạt — `infra/docs/10-chuyen-bien-the-csdl.md`                                                                                                                      | Hạ tầng                                                 | Theo V1                            |
| T11              | Mô hình AI, dịch vụ STT                                                                                                                                                                                        | Adapter trong AI Gateway                                | POC-1, POC-4                       |
| POC-2            | Đối soát từng nền tảng, hạn mức Zalo OA/Instagram, khóa 2 phút cho video                                                                                                                                       | Adapter + `error_mappings`                              | Trước khi hoàn thiện Publishing    |
| POC-2 (012)      | Giá trị khởi đầu của `content.channel_rules` (Instagram 2.200 ký tự / 30 hashtag / 25 bài mỗi 24 giờ; Zalo OA 2.000 ký tự) CHƯA xác minh; hạn mức cục bộ làm chốt, 013 kiểm tra lại lúc đăng                   | Dòng cấu hình `channel_rules` (đổi không cần phát hành) | Trước khi hoàn thiện Publishing    |
| 012 (gói, media) | Chưa có cổng kiểm tra gói còn hạn (`PLAN_GATE`, thiếu mô hình gói ở `account`) và cổng mô tả media (`MEDIA_DESCRIBER`, thiếu thư viện media): thiếu cổng media thì kênh bắt buộc media báo "chưa thể lên lịch" | `approval`, `content`                                   | Khi có module gói / thư viện media |
| POC-3            | Chất lượng nguồn xu hướng                                                                                                                                                                                      | Module `trends`                                         | Trước khi hoàn thiện Trends        |
| Q-D3/C6          | Đánh giá tác động chuyển dữ liệu xuyên biên giới                                                                                                                                                               | Màn hình đồng ý, giảm thiểu dữ liệu                     | Trước ngày ra mắt                  |
| Meta App Review  | Cần bản chạy luồng kết nối + đăng bài                                                                                                                                                                          | Ưu tiên sớm                                             | Càng sớm càng tốt                  |

Đã đóng: T7 (thư viện xác thực) — chốt ở tính năng 004, xem [004](features/004-minimal-auth-rbac.md).
