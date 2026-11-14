# 11 – Phụ thuộc nhà cung cấp và cách đổi

Hạ tầng cố ý chỉ phụ thuộc VNG Cloud ở **một chỗ** (module `provider-vngcloud`) và vào chuẩn mở ở mọi chỗ khác (Kubernetes,
giao diện S3, PostgreSQL). Tài liệu này liệt kê chỗ phụ thuộc, năng lực tối thiểu, và cách viết module cho nhà cung cấp khác.

## 1. Năng lực tối thiểu của nhà cung cấp (FR-033)

Dùng bảng này để nhận/loại một nhà cung cấp **trước** khi viết module. Cột "Kết quả thực tế" điền khi có câu trả lời V1–V13.

| #   | Năng lực                                                | Bắt buộc | VNG Cloud (theo tài liệu)         | Kết quả thực tế | Dự phòng khi thiếu                     |
| --- | ------------------------------------------------------- | -------- | --------------------------------- | --------------- | -------------------------------------- |
| C1  | Vùng dữ liệu trong nước                                 | Có       | Có (HCM, HAN)                     |                 | loại                                   |
| C2  | Kubernetes được quản lý                                 | Có       | Có (VKS)                          |                 | loại                                   |
| C3  | Kho tệp S3: phiên bản, vòng đời, đường dẫn ký sẵn, CORS | Có       | Có; chi tiết V5                   |                 | loại                                   |
| C4  | CDN HTTPS trên tên miền riêng                           | Có       | Có (vCDN); chứng chỉ V3           |                 | loại                                   |
| C5  | Quản lý khóa dùng được từ ứng dụng                      | Có       | Có; API mã hóa chưa xác minh (V4) |                 | loại / ADR mới                         |
| C6  | Tự động hóa bằng Terraform                              | Có       | Một phần                          |                 | danh sách khởi tạo một lần             |
| C7  | CSDL quản lý đạt hợp đồng                               | Không    | vDB; V1                           |                 | CloudNativePG                          |
| C8  | CDN ký đường dẫn cho media                              | Không    | "Security Link"; V3               |                 | media đi thẳng từ kho tệp              |
| C9  | Kho bí mật                                              | Không    | Không thấy                        |                 | `Secret` của Kubernetes                |
| C10 | Danh tính theo tải công việc                            | Không    | Không thấy                        |                 | khóa tĩnh trong `Secret`, xoay định kỳ |
| C11 | Nhiều vùng sẵn sàng                                     | Không    | V12                               |                 | trải khác máy                          |

## 2. Chỗ phụ thuộc VNG Cloud

| Chỗ                                     | Là gì                                                                              | Nếu đổi nhà cung cấp                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `infra/modules/provider-vngcloud/`      | Mạng, cụm VKS, nhóm máy, cân bằng tải, bucket vStorage (qua provider `aws` trỏ S3) | Viết module mới đúng hợp đồng                            |
| `infra/stacks/cloud/main.tf`            | Cấu hình provider `vngcloud` và `aws`; dòng `source` của module                    | Đổi `source` và cấu hình provider                        |
| Danh sách khởi tạo một lần              | IAM, KMS, CDN, vCR, project                                                        | Viết lại theo nhà cung cấp mới (`one-time-bootstrap.md`) |
| `tooling/infra/commands/kubeconfig.mjs` | Lấy kubeconfig từ API VKS                                                          | Đổi cách lấy kubeconfig                                  |
| `tooling/infra/lib/credentials.mjs`     | Xác minh project qua API IAM/vServer                                               | Đổi cách xác minh                                        |
| Chú thích cân bằng tải                  | `vks.vngcloud.vn/load-balancer-id` (đầu ra `ingress.service_annotations`)          | Module mới trả chú thích tương ứng                       |

Không phụ thuộc nhà cung cấp: `infra/stacks/platform/`, `infra/modules/platform-base`, `infra/modules/database-cnpg`,
`infra/smoke-deploy/`, mã ứng dụng, phần lớn `tooling/infra/`.

## 3. Viết module cho nhà cung cấp khác (5 bước)

1. Điền bảng mục 1; thiếu năng lực **bắt buộc** thì dừng.
2. Viết `infra/modules/provider-<tên>` đúng đầu vào (`contracts/provider-layer.md` mục 2) và đầu ra (mục 3).
3. Chạy lại `infra/stacks/cloud/tests/provider-contract.tftest.hcl` — phải đạt nguyên vẹn (module giả ở
   `tests/fixtures/provider-stub` cho thấy hình dạng đầu ra tối thiểu).
4. Đổi `source` trong `stacks/cloud/main.tf`; cập nhật danh sách khởi tạo cho nhà cung cấp đó.
5. **Không sửa** `stacks/platform`, `infra/smoke-deploy`, mã ứng dụng (SC-013). `tooling/test/infra/provider-isolation.spec.ts`
   bảo đảm tài nguyên của nhà cung cấp không lọt ra ngoài module.

## 4. Rủi ro còn lại

- **Một vùng sẵn sàng** (V12): mất cả vùng là mất dịch vụ; dự phòng là trải khác máy (không chống được mất vùng).
- **`Secret` có thể không mã hóa khi lưu** (V7): chấp nhận với RBAC hẹp; mã quyền nền tảng mã hóa riêng ở tầng ứng dụng bằng
  KMS (nguyên tắc VII). Xem [06](06-bi-mat-va-khoa.md) mục 5.
- **Cụm công khai có danh sách địa chỉ được phép**: giảm bề mặt nhưng không bằng cụm riêng tư; xem lại khi có người vận hành
  thứ hai (ADR-11).
- **Khóa KMS tạo tay** và API mã hóa chưa xác minh (V4): nếu không có API, ứng dụng không mã hóa được mã quyền → cần ADR mới.
- **Lọc vòng đời theo nhãn** (V5) có thể không được hỗ trợ: việc dọn tệp tạm chuyển sang Worker.
