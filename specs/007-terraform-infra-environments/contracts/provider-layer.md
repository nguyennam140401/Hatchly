# Hợp đồng: lớp nhà cung cấp (FR-031, FR-033)

Lớp nhà cung cấp là **một module Terraform** (`infra/modules/provider-<tên>`) được stack `cloud` gọi. Stack
`platform`, tệp tham số, bộ kê khai triển khai và mã ứng dụng **chỉ** dựa vào đầu ra dưới đây và vào chuẩn mở
(Kubernetes, giao diện S3, PostgreSQL). Đổi nhà cung cấp = viết module mới đúng hợp đồng này.

Bản đầu tiên: `provider-vngcloud`.

## 1. Năng lực tối thiểu của nhà cung cấp (FR-033)

Dùng bảng này để nhận hay loại một nhà cung cấp **trước** khi viết module.

| # | Năng lực | Bắt buộc | VNG Cloud (2026-11-13) | Dự phòng khi thiếu |
|---|---|---|---|---|
| C1 | Vùng dữ liệu trong nước | Có | Có (HCM, HAN) | — loại |
| C2 | Kubernetes được quản lý | Có | Có (VKS, phần điều khiển miễn phí) | — loại |
| C3 | Kho tệp S3: lưu phiên bản, luật vòng đời, đường dẫn ký sẵn, CORS | Có | Có theo tài liệu; chi tiết V5 | — loại |
| C4 | CDN HTTPS trên tên miền riêng | Có | Có (vCDN); chứng chỉ V3 | — loại |
| C5 | Dịch vụ quản lý khóa dùng được từ ứng dụng | Có | Có sản phẩm; API mã hóa **chưa xác minh (V4)** | — loại / ADR mới |
| C6 | Tự động hóa bằng Terraform | Có | Một phần: mạng, cụm, cân bằng tải, CSDL. Không: kho tệp (dùng giao diện S3), IAM, KMS, CDN, kho ảnh | Danh sách khởi tạo một lần |
| C7 | CSDL được quản lý đạt hợp đồng CSDL | Không | Có vDB; khôi phục theo thời điểm V1 | CloudNativePG |
| C8 | CDN ký đường dẫn cho media | Không | Có "Security Link"; V3 | Media đi thẳng từ kho tệp |
| C9 | Kho bí mật | Không | Không thấy | `Secret` của Kubernetes |
| C10 | Danh tính theo tải công việc | Không | Không thấy | Khóa truy cập tĩnh trong `Secret`, xoay định kỳ |
| C11 | Nhiều vùng sẵn sàng | Không | V12 | Trải trên các máy khác nhau |

## 2. Đầu vào của module

| Biến | Kiểu | Ghi chú |
|---|---|---|
| `environment` | string | `staging` \| `production` \| `drill` |
| `environment_kind` | string | `standard` \| `restore_drill` |
| `name_prefix` | string | |
| `project_id` | string | |
| `region` | string | Kiểm với `allowed_regions` |
| `allowed_regions` | list(string) | Chỉ vùng trong nước; mặc định do module đặt |
| `network_cidr`, `subnet_cidr` | string | Không trùng giữa các môi trường (để không bao giờ nối nhầm) |
| `admin_cidrs` | list(string) | Không được chứa `0.0.0.0/0` |
| `kubernetes_version` | string | Giống nhau ở hai môi trường |
| `node_groups` | map(object({ flavor, count, disk_gb, zones })) | `count ≥ 2` ở `production` |
| `powered` | bool | `false` → mọi nhóm máy `count = 0` |
| `web_origins` | list(string) | Nguồn gốc giao diện cho CORS của bucket media; cấm `*` |
| `media_retention` | object({ noncurrent_days, multipart_abort_days, tmp_days }) | Mặc định 7 / 7 / 1 |
| `backup_bucket_enabled` | bool | `true` khi `db_variant = "cnpg"` |
| `db_variant` | string | `cnpg` \| `managed` |
| `managed_db` | object | Chỉ khi `managed` |
| `deletion_protection` | bool | `true` bắt buộc mặc định ở `production` |
| `kms_key_id` | string | Khóa tạo tay; module chỉ kiểm định dạng và chuyển ra đầu ra |
| `labels` | map(string) | Thêm vào nhãn bắt buộc |

Chứng thực của provider (`client_id`, `client_secret`, khóa S3) lấy từ biến môi trường của tiến trình;
**không** là biến của module, không nằm trong tệp tham số.

## 3. Đầu ra của module (hợp đồng cố định)

| Đầu ra | Kiểu | Bên dùng |
|---|---|---|
| `cluster.endpoint` | string | `platform`, bàn giao |
| `cluster.ca_certificate` | string (chứng chỉ công khai) | `platform` |
| `cluster.name`, `cluster.id` | string | bàn giao, lệnh lấy kubeconfig |
| `cluster.storage_class` | string | `platform` (đĩa CSDL), H3 |
| `cluster.storage_class_encrypted` | bool | Kiểm tra FR-011 |
| `ingress.public_ip` | string | DNS, bàn giao |
| `ingress.load_balancer_id` | string \| null | `platform` gắn dịch vụ lối vào (null → trình cắm tự tạo) |
| `ingress.service_annotations` | map(string) | Chú thích riêng của nhà cung cấp cho dịch vụ lối vào – **chỗ duy nhất** `platform` nhận thứ riêng của nhà cung cấp, dưới dạng dữ liệu |
| `object_storage.endpoint` | string | bàn giao (`S3_ENDPOINT`) |
| `object_storage.region` | string | bàn giao (`S3_REGION`) |
| `object_storage.force_path_style` | bool | bàn giao |
| `object_storage.media_bucket` | string | bàn giao (`S3_BUCKET`) |
| `object_storage.backup_bucket` | string \| null | `platform` (CloudNativePG) |
| `database.variant` | string | `platform` |
| `database.managed_host`, `database.managed_port` | string \| null | `platform` (dịch vụ `ExternalName`) |
| `kms.key_id` | string | bàn giao |
| `network.id`, `network.subnet_id` | string | tham khảo |
| `labels` | map(string) | `platform` |

Không đầu ra nào là bí mật. Kubeconfig **không** là đầu ra: lấy bằng lệnh của nhà cung cấp, CLI bọc lại trong
`pnpm infra kubeconfig <env>`.

## 4. Bất biến module phải bảo đảm

Mỗi dòng có một kiểm thử `terraform test` tương ứng trong `infra/stacks/cloud/tests/` (lý do: `terraform test` chỉ nhận thư mục kiểm thử nằm trong thư mục stack).

1. Mọi bucket riêng tư: không ACL công khai, không policy cho `Principal: *`.
2. Bucket media: bật lưu phiên bản; có ba luật vòng đời; CORS đúng `web_origins`.
3. Bucket sao lưu: không CORS; policy không chứa danh tính của ứng dụng.
4. `region ∉ allowed_regions` → lỗi lúc lập kế hoạch.
5. Cụm có danh sách địa chỉ được phép khác rỗng và không chứa `0.0.0.0/0`.
6. Nhóm bảo mật của máy không mở cổng 22 và 5432 ra internet.
7. `environment = "production"`: `powered = true`, `count ≥ 2`, `deletion_protection = true` trừ khi đặt tường minh.
8. `environment_kind = "restore_drill"`: không cân bằng tải, không bucket mới, nhóm bảo mật chặn đi ra ngoài trừ kho tệp và kho ảnh.
9. Mọi tài nguyên có nhãn `project`, `environment`, `component`.
10. Hai môi trường không dùng chung tài nguyên nào: module không nhận định danh tài nguyên của môi trường khác làm đầu vào (ngoại lệ: `restore_drill` nhận **tên** bucket sao lưu của môi trường nguồn, chỉ để đọc).

## 5. Việc phải làm khi viết module cho nhà cung cấp khác

1. Điền bảng mục 1; thiếu năng lực bắt buộc → dừng.
2. Viết `modules/provider-<tên>` với đúng đầu vào mục 2, đầu ra mục 3.
3. Chạy lại bộ `infra/stacks/cloud/tests/provider-contract.tftest.hcl` (tham số hóa theo module) – phải đạt nguyên vẹn.
4. Đổi `source` trong `stacks/cloud/main.tf`; cập nhật `one-time-bootstrap.md` cho nhà cung cấp đó.
5. Không sửa `stacks/platform`, `infra/smoke-deploy`, mã ứng dụng (SC-013).
