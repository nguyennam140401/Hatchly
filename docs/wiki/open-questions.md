---
type: open-questions
title: Việc còn mở và giả định chưa kiểm chứng
sources:
  [
    .specify/memory/architecture.md,
    .specify/memory/constitution.md,
    infra/docs/p6-cau-hoi-nha-cung-cap.md,
  ]
updated: 2026-11-16
status: current
related: [decisions/index.md]
---

# Việc còn mở

Tóm tắt mục 12 của `.specify/memory/architecture.md`; khi lint wiki phát hiện việc mới, ghi thêm ở đây.

| Mã              | Nội dung                                                                                                                                                                                     | Ảnh hưởng                                               | Mốc                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------- |
| T4              | Nhà cung cấp đám mây VNG Cloud; còn các điểm xác minh P6 V1–V14 (V2/V4/V9 chặn) — `infra/docs/p6-cau-hoi-nha-cung-cap.md`                                                                    | Cấu hình                                                | Trước khi đưa dữ liệu thật      |
| T4c             | CSDL CloudNativePG, chuyển `managed` khi V1 đạt — `infra/docs/10-chuyen-bien-the-csdl.md`                                                                                                    | Hạ tầng                                                 | Theo V1                         |
| T11             | Mô hình AI, dịch vụ STT                                                                                                                                                                      | Adapter trong AI Gateway                                | POC-1, POC-4                    |
| POC-2           | Đối soát từng nền tảng, hạn mức Zalo OA/Instagram, khóa 2 phút cho video                                                                                                                     | Adapter + `error_mappings`                              | Trước khi hoàn thiện Publishing |
| POC-2 (012)     | Giá trị khởi đầu của `content.channel_rules` (Instagram 2.200 ký tự / 30 hashtag / 25 bài mỗi 24 giờ; Zalo OA 2.000 ký tự) CHƯA xác minh; hạn mức cục bộ làm chốt, 013 kiểm tra lại lúc đăng | Dòng cấu hình `channel_rules` (đổi không cần phát hành) | Trước khi hoàn thiện Publishing |
| 012 (gói)       | Chưa có cổng kiểm tra gói còn hạn (`PLAN_GATE`, thiếu mô hình gói ở `account`); cổng mô tả media đã nối ở 014                                                                                | `approval`, `content`                                   | Khi có module gói               |
| POC-3           | Chất lượng nguồn xu hướng                                                                                                                                                                    | Module `trends`                                         | Trước khi hoàn thiện Trends     |
| Q-D3/C6         | Đánh giá tác động chuyển dữ liệu xuyên biên giới                                                                                                                                             | Màn hình đồng ý, giảm thiểu dữ liệu                     | Trước ngày ra mắt               |
| Meta App Review | Cần bản chạy luồng kết nối + đăng bài                                                                                                                                                        | Ưu tiên sớm                                             | Càng sớm càng tốt               |

| 011-T074 | Chuyển `ProfileForm`/`KeywordsInput` (006) sang `useAppForm`/`TagListField`; mới chuyển lớp giao diện, chưa thử RHF | Đồng nhất biểu mẫu | Tính năng sửa hồ sơ kế tiếp; chi tiết ở [011](features/011-ui-architecture-foundation.md) |
| 011-kiểm thủ công | Chưa kiểm: `prefers-reduced-motion`, bộ đọc màn hình thật, đo cập nhật ≤ 1 giây; kiểm thử cũ 004/006/009 đã chỉnh khẳng định `aria-disabled` cần người review | Trợ năng, SC-011 | Trước ra mắt |
| 011-Figma | Figma thiếu: "Đã hủy", trạng thái Field, khung chờ/hộp thoại/ngoại tuyến, 4 kênh `ChannelTabs`, Figma Variables; PO xác nhận điều hướng 7/5, điểm ngắt 1024 px, bảng màu teal | Giao diện | Người thiết kế + PO |
| 011-verify-đỏ | `pnpm verify` đỏ có sẵn ở `dev`: `tooling/test/check-wiki.spec.ts` (typecheck), `tooling/infra` thiếu `kubeconfig.mjs` (test) | Cổng CI | Sửa ở tính năng sở hữu |
| 013-POC-2 | Chi tiết Graph API của Facebook/Instagram (điểm cuối, trường, mã lỗi, khả năng ĐỌC LẠI bài để đối soát, thời gian xử lý video Instagram, hạn mức 24 giờ) là GIẢ ĐỊNH; `META_FACEBOOK_RECONCILE`/`META_INSTAGRAM_RECONCILE` mặc định tắt → bài mơ hồ vào "Cần kiểm tra" | Kết quả POC-2 + Meta App Review; `error_mappings` và năng lực đối soát chỉnh bằng cấu hình/dữ liệu | Trước khi bật `PLATFORM_ADAPTER_MODE=real` ở staging |
| 013-010 | Bộ chuyển đổi thật (`PLATFORM_ADAPTER_MODE=real`) chưa đăng được cho tới khi 010 giao kho kết nối thật, vault KMS và OAuth (`authorizeUrl`/`exchangeCallback`/`refreshToken` của hai bộ chuyển đổi mới còn báo "thuộc 010") | Tính năng 010 | Trước ngày ra mắt |
| 013-media | Đã có `getPublishableMedia` thật từ 014; chuyển đổi định dạng do 014 làm lúc tải lên (ảnh → JPEG), bước 2 chỉ đọc lý do `conversion_failed`/`not_ready` (T073 xong); còn: giới hạn video Facebook 1 GB (PO) lệch FR-03 (500 MB) – là tham số `FACEBOOK_VIDEO_MAX_BYTES`/`mediaRules()` | PO/SA: cập nhật FR-03 | Khi rà FR-03 |
| 013-gói | `AccountPublicApi.getPublishingEligibility` suy `planActive` từ `accounts.status = 'active'` (chưa có mô hình gói) – ADR-12 chờ SA duyệt | Mô hình gói/chu kỳ ở `account` | Khi làm gói dịch vụ |
| 013-T085 | Chưa kiểm chứng với nền tảng thật (quickstart mục 3): ghi lại đọc được bài đã đăng không, thời gian xử lý Instagram, hạn mức, giới hạn video | Tài khoản thử của Meta + 010 | Trước Meta App Review |
| 013-nối-UI | Màn hình Tiến trình đăng mở từ danh sách Bài viết (`/posts/:id/progress`) và liên kết trong thông báo; chưa gắn vào chi tiết bài/Lịch (ComposePage chưa hiển thị trạng thái đăng) | Làm lại điều hướng chi tiết bài | Tính năng kế tiếp của 012 |
| 014-T090 | Chưa đo SC-001/002/003/007/010 trên 4G và vStorage thật; chưa đối chiếu ngân sách kho thực với bảng trong `plan.md` | Chạy đo, ghi `research.md` mục "Kết quả đo" | Trước ra mắt |
| 014-T093 | Chưa chạy tay 14 bước và 6 thử nghiệm kỹ thuật của `quickstart.md` (kể cả HEIC từ iPhone thật, tải nhiều phần qua vStorage) | Môi trường có trình duyệt thật + kho thật | Trước ra mắt |
| 014-FR-023 | Mã phiên `uploadId` vẫn nằm trong đường dẫn của nhật ký truy cập chung (core); chỉ dòng do `media` ghi là sạch. Muốn cấm hẳn phải che UUID trong URL ở lớp ghi nhật ký của core (ảnh hưởng mọi module) | Quyết định của PO/SA | Khi rà FR-023 |
| 014-gói | `UploadGate` mặc định `allowed: true` (chưa có mô hình gói) nên "gói hết hạn" chưa chặn tải thật | Mô hình gói ở `account` | Khi làm gói dịch vụ |
| 014-trùng-format | Logic đổi MIME → `jpeg`/`mp4` lặp ở `media` (`formatOf`) và `content` (`media-describer.ts`) | Cho `describe` trả sẵn `format` hoặc export hàm dùng chung | Khi sửa tiếp |
| 014-verify-đỏ | `pnpm verify` còn đỏ ngoài 014: `tooling/test/check-wiki.spec.ts` (typecheck), `tooling/infra` thiếu `kubeconfig.mjs`; `test:queue` `purge-account` lỗi khi chạy cả bộ, đạt khi chạy riêng | Sửa ở tính năng sở hữu | Trước release |

Đã đóng: T7 (thư viện xác thực) — chốt ở tính năng 004, xem [004](features/004-minimal-auth-rbac.md).
