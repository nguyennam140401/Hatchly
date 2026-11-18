---
type: concept
title: Danh sách tính năng và trạng thái đáp ứng
sources:
  [
    TaiLieuDacTa/Dac_ta_yeu_cau_App_AI_Content_MXH.md,
    specs/001-monorepo-module-skeleton/tasks.md,
    specs/004-minimal-auth-rbac/tasks.md,
    specs/007-terraform-infra-environments/tasks.md,
    specs/008-cicd-jenkins-pipeline/tasks.md,
    specs/009-social-login-members/tasks.md,
    specs/010-connect-facebook-instagram/spec.md,
    specs/011-ui-architecture-foundation/spec.md,
  ]
updated: 2026-11-15
status: current
related:
  [
    features/009-social-login-members.md,
    features/006-sample-module-business-profile.md,
    decisions/index.md,
  ]
---

# Danh sách tính năng và trạng thái đáp ứng

Số liệu tính đến **2026-11-15**, đếm từ các `specs/*/tasks.md` (task `[x]` / tổng). Cập nhật lại sau mỗi lần merge một tính năng.
"Task xong" nghĩa là đã đánh dấu trong `tasks.md`, không đồng nghĩa đã chạy thật trên môi trường cloud.

## A. Tính năng nghiệp vụ (theo FR trong đặc tả yêu cầu)

| FR           | Tính năng                                                  | Trạng thái                                                                    | Spec liên quan |
| ------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------- |
| FR-15        | Đăng nhập email, Google, Facebook; mời và gỡ cộng tác viên | **Gần xong**                                                                  | 004, 009       |
| FR-01        | Ngữ cảnh kinh doanh (Hồ sơ kinh doanh)                     | **Một phần**: có bản mẫu, chưa có sản phẩm, chính sách, nhập giọng nói        | 006            |
| FR-02        | Kết nối kênh Facebook Page, Instagram, Zalo OA             | **Chưa làm**: mới có spec 010, cổng nền tảng chỉ là bản giả lập               | 005, 010       |
| FR-03        | Thư viện media, AI gán nhãn                                | **Một phần**: có thư viện cơ bản (tải, xử lý, 5 GB, xóa); chưa có AI gán nhãn | 014            |
| FR-04        | Lập kế hoạch tuần/tháng                                    | Chưa làm                                                                      | –              |
| FR-05        | AI tạo nội dung theo kênh                                  | Chưa làm (chỉ có hợp đồng và giả lập Cổng AI)                                 | 005            |
| FR-06        | Duyệt và lên lịch                                          | Chưa làm                                                                      | –              |
| FR-07        | Đăng bài đúng lịch                                         | Chưa làm (đã có nền hàng chờ pg-boss)                                         | 003            |
| FR-08, FR-09 | Theo dõi 5 bước đăng, xử lý lỗi                            | Chưa làm                                                                      | –              |
| FR-10        | Tra cứu cho đội hỗ trợ                                     | Chưa làm (đã có vai trò hỗ trợ và nhật ký kiểm toán)                          | 004, 009       |
| FR-11, FR-12 | Ngân sách AI, hiển thị mức sử dụng                         | Chưa làm (chỉ có hợp đồng Cổng AI)                                            | 005            |
| FR-13        | Quản trị gói (nội bộ)                                      | Chưa làm                                                                      | –              |
| FR-14        | Yêu cầu xóa tài khoản                                      | Chưa làm                                                                      | –              |

## B. Nền kỹ thuật và tính năng đã có spec

| Spec | Nội dung                       | Task xong     | Việc còn mở                                                                                                                                                                 |
| ---- | ------------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001  | Monorepo, ranh giới module     | 64/64         | –                                                                                                                                                                           |
| 002  | Lớp CSDL, RLS tenant           | 77/77         | –                                                                                                                                                                           |
| 003  | Hàng chờ pg-boss               | 75/75         | –                                                                                                                                                                           |
| 004  | Xác thực email và RBAC         | 87/88         | T087: chạy tay quickstart                                                                                                                                                   |
| 005  | Hợp đồng cổng và bản giả lập   | 99/99         | –                                                                                                                                                                           |
| 006  | Module mẫu Hồ sơ kinh doanh    | 73/74         | T074: diễn tập SC-008                                                                                                                                                       |
| 007  | Hạ tầng Terraform              | 110/121       | 11 việc thủ công: dựng staging/production, drill sao lưu                                                                                                                    |
| 008  | CI/CD Jenkins                  | 81/99         | 18 việc: ADR-11, dựng Jenkins thật, quickstart; một phần chờ 007                                                                                                            |
| 009  | Đăng nhập xã hội và thành viên | 91/94         | T057, T091, T092                                                                                                                                                            |
| 010  | Kết nối Facebook/Instagram     | chưa có tasks | Mới có spec (Draft)                                                                                                                                                         |
| 011  | Nền kiến trúc giao diện        | 84/85         | **T074** (chuyển `ProfileForm` sang `useAppForm`); kiểm thủ công 9, 12, 13 chưa làm. Đã merge `dev` 2026-11-16, nhánh `impl/011` được giữ                                   |
| 014  | Thư viện media cơ bản          | 92/94         | **T090** (đo hiệu năng 4G/vStorage), **T093** (thử tay quickstart). Đã merge `dev` 2026-11-18, nhánh `impl/014` được giữ                                                    |
| 012  | Soạn bài tay, duyệt, lịch      | 91/95         | **T059** (số bài chờ trên điều hướng), **T066** (tab Lịch sử), T093 (2 lỗi có sẵn từ dev), T094 (chạy tay quickstart). Đã merge `dev` 2026-11-16, nhánh `impl/012` được giữ |

## C. Giao diện hiện có

Đăng nhập, đăng ký, xác minh email, quên/đặt lại mật khẩu, bảo mật, Hồ sơ kinh doanh, thành viên, tài khoản chờ, lời mời.
Đã có khung ứng dụng (thanh bên 7 mục / thanh dưới 5 ô theo quyền), hộp đăng nhập lại khi hết phiên và danh mục `/_catalog` (011);
từ 012 có thêm Soạn/xem bài, Chờ duyệt, Lịch và Bài viết; từ 014 có Thư viện ảnh & video (`/media`); Kênh và gói vẫn là trang "sắp có" (`ComingSoon`). Xem [web-ui](web-ui.md).

## D. Thứ tự đề xuất làm tiếp

1. Làm nốt T074 của 011 (chuyển `ProfileForm` sang `useAppForm`) – có thể gộp vào tính năng sửa hồ sơ kế tiếp.
2. 010 (kết nối kênh), vì đăng bài cần kênh đã kết nối.
3. Lập kế hoạch, AI tạo nội dung. Soạn bài tay, duyệt, lịch (012), đăng bài 5 bước (013) và thư viện media cơ bản (014) đã merge; còn T090/T093 của 014 và T059/T066 của 012.
4. Chốt việc dở của 007 và 008 trước khi cần môi trường thật (tốn chi phí cloud).

## Cách cập nhật

Đếm lại bằng: `grep -c '^\s*- \[[xX]\]' specs/<NNN>/tasks.md` (xong) và `'^\s*- \[ \]'` (còn lại).
