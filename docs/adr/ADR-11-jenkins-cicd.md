# ADR-11: Jenkins tự vận hành điều phối quy trình tích hợp và triển khai

- **Trạng thái**: Đề xuất – chờ chủ dự án (PO) xác nhận lý do ở mục 5 và SA duyệt
- **Ngày**: 2026-11-13
- **Tính năng**: `specs/008-cicd-jenkins-pipeline` (FR-047) · WBS H2
- **Liên quan**: ADR-01 (một ảnh, hai đơn vị triển khai), ADR-08 (ít thành phần), ADR-10 (đám mây trong nước);
  hiến pháp nguyên tắc VII, IX và mục "Quy trình phát triển & cổng chất lượng"
- **Ghi chú vị trí**: ADR-01…10 nằm trong `TaiLieuDacTa/ADR_App_AI_Content_MXH.md` (không theo dõi bằng Git). ADR
  này đặt trong kho mã để được review cùng mã; khi cập nhật bộ tài liệu đặc tả cần thêm dòng tham chiếu vào bảng ADR.

## 1. Bối cảnh

- Hiến pháp bắt buộc năm kiểm tra tự động **chặn hợp nhất** và yêu cầu `api` + `worker` phát hành cùng nhau với
  migration tương thích ngược. Hiện `pnpm verify` chỉ chạy khi lập trình viên nhớ; ảnh được dựng và triển khai tay.
- Cổng chuyển sang đợt 1 yêu cầu có H2. Đội 3–4 người, không có người vận hành riêng.
- Bảng ngăn xếp công nghệ của hiến pháp **không chốt** công cụ tích hợp–triển khai; nguyên tắc IX cấm thêm dịch vụ
  mới ở giai đoạn 1 khi chưa có ADR.
- Chủ dự án yêu cầu Jenkins có mặt trong quy trình (mô tả tính năng 008) và đã chốt: mã trên GitHub (kho riêng tư),
  Jenkins trên một máy ảo riêng trong nước ngoài hai cụm, thông báo qua Telegram (Clarifications 2026-11-13).

## 2. Phương án

|     | Phương án                                      | Tóm tắt                                                                 |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| A   | **Jenkins tự vận hành** trên máy ảo trong nước | Một máy ảo; cấu hình bằng mã (JCasC + Job DSL); hai tác nhân tách quyền |
| B   | GitHub Actions, máy chạy do GitHub lưu trữ     | Không có máy phải vận hành; thông tin triển khai lưu ở GitHub           |
| C   | GitHub Actions, máy chạy tự lưu trữ trong nước | Điều phối ở GitHub, việc chạy trên máy ảo của đội                       |
| D   | GitLab tự vận hành (kho mã + CI)               | Một dịch vụ lớn hơn, thay luôn GitHub                                   |

## 3. Tiêu chí có trọng số (điểm 1–5, cao hơn là tốt hơn)

| Tiêu chí                                                                                               | Trọng số | A        | B        | C        | D        |
| ------------------------------------------------------------------------------------------------------ | -------- | -------- | -------- | -------- | -------- |
| Công vận hành cho đội nhỏ (nguyên tắc IX)                                                              | 25%      | 2        | 5        | 3        | 1        |
| Thông tin triển khai release và nhật ký dựng nằm trong nước, đội tự kiểm soát (nguyên tắc VII, ADR-10) | 20%      | 5        | 2        | 3        | 5        |
| Cô lập mã chưa review khỏi thông tin triển khai                                                        | 20%      | 4        | 5        | 3        | 4        |
| Chi phí cố định hằng tháng                                                                             | 15%      | 3        | 4        | 3        | 2        |
| Không khóa vào một nhà cung cấp (đổi nơi lưu mã không phải viết lại quy trình)                         | 10%      | 5        | 2        | 2        | 3        |
| Đáp ứng yêu cầu trực tiếp của chủ dự án                                                                | 10%      | 5        | 1        | 1        | 1        |
| **Tổng**                                                                                               | 100%     | **3,75** | **3,55** | **2,70** | **2,75** |

Điểm là đánh giá định tính của SA, chưa đo. Nếu **bỏ** tiêu chí "yêu cầu của chủ dự án" và chia lại trọng số thì B
dẫn (≈ 3,8 so với ≈ 3,6 của A): xét riêng công vận hành, đề xuất của SA là B. Khác biệt được ghi ở mục 5.

## 4. Quyết định

Chọn **A – Jenkins tự vận hành**, với các ràng buộc sau để bù điểm yếu về vận hành và an toàn:

1. Một máy ảo trong nước, ngoài cả hai cụm Kubernetes; bộ điều khiển không chạy việc; hai tác nhân dưới hai người
   dùng hệ điều hành với Docker rootless riêng (kiểm tra / triển khai).
2. Toàn bộ cấu hình là mã trong kho (`infra/ci/`, `ops/ci/`); không cấu hình bằng giao diện; dựng lại ≤ 4 giờ.
3. Jenkins **chỉ điều phối**: mọi kiểm tra nằm trong `pnpm verify`, mọi bước triển khai là tập lệnh trong
   `ops/deploy/` chạy được từ máy của SA. Đổi công cụ điều phối sau này không phải viết lại kiểm tra hay triển khai.
4. Giao diện Jenkins không mở ra internet; lối vào duy nhất là điểm nhận webhook có kiểm chữ ký.
5. Lịch sử triển khai lưu ở GitHub Deployments để không mất khi dựng lại Jenkins.
6. Không thêm dịch vụ chạy nào khác (không Argo CD/Flux, không VPN, không máy chủ cấu hình).

## 5. Quyết định của chủ dự án khác đề xuất của SA – lý do

Xét riêng công vận hành, SA nghiêng về B. Chủ dự án chọn Jenkins. Lý do đã ghi nhận được:

- Yêu cầu trực tiếp trong mô tả tính năng: "tôi muốn Jenkins có mặt trong quy trình triển khai tự động này".
- Hệ quả phù hợp với nguyên tắc VII / ADR-10: thông tin triển khai của release và nhật ký dựng không nằm ở dịch vụ
  nước ngoài.

**Cần chủ dự án bổ sung** nếu còn lý do khác (ví dụ kinh nghiệm sẵn có, định hướng tự chủ hạ tầng) để hoàn tất yêu
cầu "ghi lý do" của hiến pháp.

## 6. Hệ quả

**Được**: năm kiểm tra bắt buộc chặn hợp nhất thật sự; hợp nhất là triển khai, không thao tác tay; thông tin triển
khai tách theo môi trường và nằm trong nước; quy trình không gắn chặt vào GitHub.

**Mất / phải chấp nhận**:

- Thêm một dịch vụ phải vận hành: cập nhật Jenkins và phần mở rộng, theo dõi đĩa, sao lưu, xoay thông tin xác thực.
- Chi phí cố định một máy ảo chạy liên tục (kích thước ban đầu 8 vCPU / 16 GB / 200 GB, điều chỉnh sau khi đo).
- Jenkins là điểm lỗi đơn của **quy trình** (không phải của ứng dụng): ngừng thì khóa hợp nhất cho tới khi dựng lại;
  có tài liệu triển khai khẩn cấp bằng tay.
- Bề mặt tấn công của Jenkins và phần mở rộng; giảm bằng ràng buộc 1, 4 và cố định phiên bản.
- Luật bảo vệ nhánh trên kho riêng tư cần gói GitHub trả phí.

**Bên nhận dữ liệu ở nước ngoài mới (quy trình phát triển, không phải ứng dụng)**:

| Bên nhận | Dữ liệu                                                                                                          | Dữ liệu khách hàng |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ------------------ |
| GitHub   | mã nguồn, kết quả kiểm tra, bản ghi triển khai (commit, digest ảnh, tên người hợp nhất/duyệt, tên tệp migration) | không              |
| Telegram | môi trường, kết quả, SHA rút gọn, tên tác giả, bước hỏng, đường dẫn Jenkins                                      | không              |

Hai bên nhận này **được ghi thêm** vào danh sách chuyển dữ liệu xuyên biên giới (Kiến trúc dữ liệu mục 9) với ghi
chú "quy trình phát triển, không có dữ liệu khách hàng" – hiến pháp nguyên tắc VII yêu cầu ghi mọi bên nhận mới ở
nước ngoài; các mục của ứng dụng trong danh sách không đổi. Điều kiện kèm theo:
kho mã không chứa bí mật (cổng quét bí mật, không cho ngoại lệ) và không dữ liệu khách hàng nào đi vào hai kênh này.

## 7. Xem xét lại khi

- Công vận hành Jenkins vượt khoảng 4 giờ/tháng trong ba tháng liên tiếp, hoặc có sự cố an toàn liên quan Jenkins.
- Jenkins ngừng làm khóa hợp nhất quá 4 giờ, hai lần trong một quý.
- Thời gian cổng chất lượng vượt 15 phút (p95) dù đã tăng cấu hình máy → cân nhắc tách hai máy ảo (kiểm tra /
  triển khai) hoặc phương án C.
- Docker rootless trên một máy không giữ được cô lập giữa hai tác nhân theo phép thử của US4 → tách hai máy ảo.
- Đổi nơi lưu mã khỏi GitHub, hoặc kết luận pháp lý (Q-D3) coi mã nguồn / siêu dữ liệu triển khai là dữ liệu phải
  lưu trong nước.
- Đội lớn hơn 8 người hoặc có người vận hành riêng.
