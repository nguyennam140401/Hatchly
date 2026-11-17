# P6 – Thư hỏi VNG Cloud và báo giá

Nguồn: `specs/007-terraform-infra-environments/research.md`, bảng "Danh sách xác minh P6" (V1–V14).
Gửi cho kênh kinh doanh/kỹ thuật của VNG Cloud. Điền cột bên phải khi có trả lời; **không** sửa nội dung câu hỏi.

## Thư gửi

> Kính gửi VNG Cloud,
>
> Chúng tôi là một đội nhỏ chuẩn bị vận hành ứng dụng web (API + Worker + PostgreSQL + kho tệp) trên VNG Cloud,
> vùng HCM, gồm hai môi trường tách biệt (thử nghiệm và phát hành). Xin báo giá và trả lời 14 câu hỏi kỹ thuật dưới
> đây để chúng tôi chốt thiết kế. Các câu **V2, V4, V9** (và **V5** khi thiếu lưu phiên bản hoặc mã hóa khi lưu) quyết
> định việc chúng tôi có dùng VNG Cloud cho môi trường phát hành hay không, xin ưu tiên trả lời.
>
> Xin cảm ơn.

## Câu hỏi

| #   | Câu hỏi                                                                                                                                                                                                                              | Chặn?                                                           | Trả lời | Ngày | Đạt/Không đạt | Hệ quả đã áp dụng |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------- | ---- | ------------- | ----------------- |
| V1  | vDB PostgreSQL có lưu nhật ký giao dịch liên tục và khôi phục về thời điểm bất kỳ không?                                                                                                                                             | Không (chỉ nhánh `managed`)                                     |         |      |               |                   |
| V2  | Chính sách IAM có giới hạn được tài khoản dịch vụ trong **một project** (vServer, VKS, vStorage) không? Có chính sách chỉ đọc không?                                                                                                 | **CHẶN** phát hành                                              |         |      |               |                   |
| V3  | vCDN: tên miền riêng + chứng chỉ tự cấp/gia hạn? Nguồn là bucket riêng tư được không? Có luật trả tệp vào? Security Link dùng với media được không? Có API không?                                                                    | Không                                                           |         |      |               |                   |
| V4  | KMS có API mã hóa/giải mã cho ứng dụng bằng tài khoản dịch vụ không? Xoay khóa có giữ phiên bản cũ? Có nhật ký dùng khóa?                                                                                                            | **CHẶN** (mã quyền thật)                                        |         |      |               |                   |
| V5  | vStorage HCM04 qua API S3: `PutBucketVersioning`, `PutBucketLifecycleConfiguration` (lọc theo **nhãn**, hết hạn phiên bản cũ, dọn tải dở), `PutBucketCors`, `PutBucketPolicy`, POST policy, tải nhiều phần (014: `CreateMultipartUpload`, **`UploadPart` ký sẵn** có ràng buộc `Content-Length`, `ListParts`, ghép phần `CompleteMultipartUpload`, `AbortMultipartUpload`), luật vòng đời bucket **`AbortIncompleteMultipartUpload`** (hủy tải dở sau 2 ngày), mã hóa khi lưu mặc định? | **CHẶN có điều kiện** (thiếu lưu phiên bản hoặc mã hóa khi lưu) |         |      |               |                   |
| V6  | vStorage có hỗ trợ ghi có điều kiện `If-None-Match` (khóa trạng thái Terraform)?                                                                                                                                                     | Không                                                           |         |      |               |                   |
| V7  | VKS có mã hóa `Secret` trong etcd khi lưu không? Bằng khóa KMS của khách hàng được không? Có nhật ký truy cập API của cụm?                                                                                                           | Không                                                           |         |      |               |                   |
| V8  | Dịch vụ `LoadBalancer` của cụm có gắn được vào một cân bằng tải tạo sẵn (giữ địa chỉ qua lần dựng lại cụm) không?                                                                                                                    | Không                                                           |         |      |               |                   |
| V9  | Loại đĩa có mã hóa khi lưu cho VKS? Lớp lưu trữ nào?                                                                                                                                                                                 | **CHẶN** phát hành                                              |         |      |               |                   |
| V10 | Giá: máy theo giờ, cân bằng tải, đĩa, vStorage, băng thông ra, vCDN theo GB, KMS; ưu đãi tài khoản mới                                                                                                                               | Không                                                           |         |      |               |                   |
| V11 | vCR: có luật thẻ ảnh không ghi đè? Tài khoản robot chỉ kéo?                                                                                                                                                                          | Không                                                           |         |      |               |                   |
| V12 | Số vùng sẵn sàng tại vùng chọn; cam kết khả dụng của VKS                                                                                                                                                                             | Không                                                           |         |      |               |                   |
| V13 | Nhóm máy `num_nodes = 0` / xóa nhóm máy khi cụm còn: phần điều khiển có tính phí không?                                                                                                                                              | Không                                                           |         |      |               |                   |
| V14 | Tài khoản có nhật ký hoạt động quản trị (ai, làm gì, lúc nào)? Giữ bao lâu?                                                                                                                                                          | Không                                                           |         |      |               |                   |

## Khi kết quả "Không đạt"

Dự phòng của từng câu nằm trong research.md. Điểm dừng cần hỏi chủ dự án:

- **V2** không đạt → xem lại quyết định "một tài khoản"; dự phòng là tách hai tài khoản gốc.
- **V4** không đạt → nhà cung cấp không đạt năng lực bắt buộc (FR-033); cần ADR mới.
- **V9** không đạt → ghi rủi ro và hỏi lại trước khi phát hành.
- **V5** thiếu lưu phiên bản hoặc mã hóa khi lưu → chặn phát hành.
