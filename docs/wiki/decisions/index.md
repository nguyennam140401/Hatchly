---
type: decision
title: Chỉ mục quyết định kiến trúc (ADR-01…11)
sources:
  [
    TaiLieuDacTa/ADR_App_AI_Content_MXH.md,
    docs/adr/ADR-11-jenkins-cicd.md,
    .specify/memory/constitution.md,
  ]
updated: 2026-11-14
status: current
related:
  [
    concepts/module-boundaries.md,
    concepts/tenant-rls.md,
    concepts/queues.md,
    concepts/publish-idempotency.md,
    concepts/ai-budget.md,
    concepts/ci-cd.md,
    concepts/infra-envs.md,
  ]
---

# Chỉ mục ADR

Một dòng mỗi ADR; chi tiết (bối cảnh, phương án, tiêu chí, hệ quả) ở nguồn. ★ = quyết định khách hàng duyệt (đổi cần PO).
ADR-01…10 ở `TaiLieuDacTa/ADR_App_AI_Content_MXH.md` (không theo dõi bằng Git); ADR-11 ở `docs/adr/`.

| ADR  | Quyết định                                                                                                                                | Trạng thái                                                               | Xem xét lại khi                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01   | Modular monolith, 2 đơn vị triển khai (API + Worker) - [module-boundaries](../concepts/module-boundaries.md)                              | Đã chốt                                                                  | Xử lý media làm lệch lịch > 5 phút dù đã tách hàng chờ; hoặc module cần nhịp phát hành/mở rộng khác hẳn                                                              |
| 02   | Chung CSDL, tách tenant bằng mã tài khoản + RLS - [tenant-rls](../concepts/tenant-rls.md)                                                 | Đã chốt                                                                  | Khách doanh nghiệp đòi cô lập riêng -> mô hình lai                                                                                                                   |
| 03   | Hàng chờ bền vững trên PostgreSQL (pg-boss) + bộ hẹn giờ chung - [queues](../concepts/queues.md)                                          | Đã chốt                                                                  | > ~50.000 việc/giờ, hoặc tách module đăng bài thành dịch vụ riêng                                                                                                    |
| 04 ★ | Chống đăng trùng: không tự thử lại khi kết quả không xác định, đối soát trước - [publish-idempotency](../concepts/publish-idempotency.md) | Đã duyệt (theo đề xuất)                                                  | Nền tảng có khóa chống trùng, hoặc "Cần kiểm tra" > 1% lượt đăng                                                                                                     |
| 05 ★ | Tự xây bộ chuyển đổi từng nền tảng sau một giao diện chung                                                                                | Đã duyệt (theo đề xuất)                                                  | App Review bị từ chối nhiều lần, hoặc cần ≥ 3 nền tảng mới trong 6 tháng                                                                                             |
| 06   | Cổng AI nội bộ: giữ chỗ ngân sách trước mỗi lần gọi - [ai-budget](../concepts/ai-budget.md)                                               | Đã chốt                                                                  | POC-1 cho thấy mô hình rẻ không đạt chất lượng -> chỉnh ngưỡng/giá gói                                                                                               |
| 07 ★ | Media tải thẳng lên kho; gán nhãn video bằng 8 khung hình + âm thanh ≤ 5 phút đầu                                                         | 7a đã chốt; 7b đã duyệt (khác đề xuất SA)                                | POC-4: chi phí gán nhãn > 25% ngân sách AI, STT tiếng Việt < 85%, hoặc băng thông > 20% chi phí hạ tầng                                                              |
| 08   | Không dùng cache phân tán ở giai đoạn 1                                                                                                   | Đã chốt                                                                  | p95 truy vấn Lịch/Tổng quan > 200 ms; > 5 bản API; hoặc cần thông báo thời gian thực nhiều bản API                                                                   |
| 09   | Khóa ngoại chỉ trong module và tới bảng tài khoản; giữa module dùng mã tham chiếu                                                         | Đã chốt                                                                  | Tham chiếu hỏng 2 tuần liên tiếp, hoặc quyết định không bao giờ tách module                                                                                          |
| 10 ★ | Hạ tầng đặt tại đám mây trong nước - [infra-envs](../concepts/infra-envs.md)                                                              | Đã duyệt (khác đề xuất SA)                                               | Q-D3 kết luận không bắt buộc trong nước **và** vận hành K8s/CSDL tự chạy > 3 ngày công/tháng; hoặc nhà cung cấp không đạt 3 điểm xác minh                            |
| 11   | Jenkins tự vận hành (máy ảo trong nước) điều phối tích hợp + triển khai - [ci-cd](../concepts/ci-cd.md)                                   | **Đề xuất** (file ghi chờ PO xác nhận lý do + SA duyệt, dù 008 đã merge) | Công vận hành > ~4 giờ/tháng 3 tháng liền; khóa merge > 4 giờ hai lần/quý; cổng p95 > 15 phút; cô lập tác nhân thất bại; đổi nơi lưu mã/kết luận Q-D3; đội > 8 người |

Quy tắc: quyết định mới hoặc đi ngược ADR phải có ADR (hiến pháp IX). Thay đổi liên quan ADR-04, 05, 07b, 10 cần PO duyệt.
