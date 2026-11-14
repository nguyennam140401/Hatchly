# infra/ – hạ tầng dưới dạng mã (tính năng 007)

> **Không gọi `terraform` trực tiếp với môi trường thật – dùng `pnpm infra <lệnh> <env>`.**
> CLI bảo đảm ba lớp chặn (đã chạy ở thử nghiệm, đúng bản xem trước đã lưu, chặn xóa dữ liệu).

## Bắt đầu nhanh

```
pnpm infra check                     # kiểm tra tĩnh – không cần tài khoản đám mây
pnpm infra bootstrap-check staging   # đã làm đủ việc tay ban đầu chưa?
pnpm infra up staging                # dựng môi trường thử nghiệm lần đầu
pnpm infra plan staging              # xem trước thay đổi  →  pnpm infra apply staging
pnpm infra smoke staging             # kiểm tra ứng dụng chạy đúng
```

Chạy `pnpm infra` không đối số để xem đủ 19 lệnh. Cần cài **Terraform đúng phiên bản** ở `infra/.terraform-version` và tflint
(ghi ở đầu `infra/.tflint.hcl`); thiếu thì `pnpm infra check` in `SKIPPED` cho phần cần chúng.

## Thư mục

| Thư mục                 | Mục đích                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `modules/`              | Module Terraform: `provider-vngcloud` (lớp nhà cung cấp, nơi duy nhất có `vngcloud_*`/`aws_s3_*`), `platform-base`, `database-cnpg` |
| `stacks/cloud/`         | Stack hạ tầng đám mây (mạng, cụm, cân bằng tải, kho tệp)                                                                            |
| `stacks/platform/`      | Stack nền tảng Kubernetes (ingress, cert-manager, CloudNativePG, RBAC, NetworkPolicy)                                               |
| `stacks/<stack>/tests/` | `terraform test` với `mock_provider`, chạy theo từng stack                                                                          |
| `envs/`                 | Tệp tham số `staging.tfvars`, `production.tfvars`, cấu hình backend, mẫu môi trường tạm                                             |
| `smoke-deploy/`         | Kê khai triển khai **tạm** để chạy bộ kiểm tra khói (H2 thay và xóa)                                                                |
| `docs/`                 | Tài liệu hướng dẫn triển khai và vận hành (tiếng Việt)                                                                              |

## Tài liệu

|                                                                                                        |                                                  |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| [00 – Tổng quan](docs/00-tong-quan.md)                                                                 | bức tranh, thuật ngữ, mã thoát                   |
| [01 – Khởi tạo lần đầu](docs/01-khoi-tao-lan-dau.md)                                                   | việc làm tay một lần                             |
| [02 – Dựng môi trường](docs/02-dung-moi-truong.md)                                                     | chuẩn bị máy, tham số, `pnpm infra up`           |
| [03 – DNS và chứng chỉ](docs/03-dns-va-chung-chi.md)                                                   | bản ghi DNS, CDN, gỡ rối chứng chỉ               |
| [04 – Triển khai ảnh và kiểm tra khói](docs/04-trien-khai-anh-va-kiem-tra-khoi.md)                     | đẩy ảnh theo digest, `smoke`                     |
| [05 – Quy trình thay đổi](docs/05-quy-trinh-thay-doi.md)                                               | ba lớp chặn, kiểm tra lệch                       |
| [06 – Bí mật và khóa](docs/06-bi-mat-va-khoa.md)                                                       | `secrets init/set/list/rotate`                   |
| [07 – Khôi phục CSDL](docs/07-khoi-phuc-csdl.md)                                                       | diễn tập mỗi quý, khôi phục thật                 |
| [08 – Xử lý sự cố](docs/08-xu-ly-su-co.md)                                                             | khóa trạng thái, lệch, chứng chỉ, hủy môi trường |
| [09 – Tắt/bật thử nghiệm](docs/09-tat-bat-thu-nghiem.md)                                               | tiết kiệm chi phí                                |
| [10 – Chuyển biến thể CSDL](docs/10-chuyen-bien-the-csdl.md)                                           | `cnpg` ↔ `managed`                               |
| [11 – Phụ thuộc nhà cung cấp](docs/11-phu-thuoc-nha-cung-cap.md)                                       | đổi nhà cung cấp                                 |
| [Thư hỏi VNG Cloud](docs/p6-cau-hoi-nha-cung-cap.md), [Kết quả kiểm chứng](docs/ket-qua-kiem-chung.md) | 14 câu xác minh, số đo thực                      |

Hợp đồng và thiết kế: `specs/007-terraform-infra-environments/` (`contracts/`, `research.md`, `quickstart.md`).

Terraform không giữ giá trị bí mật; `pnpm infra secrets` tạo `Secret` trong cụm.
