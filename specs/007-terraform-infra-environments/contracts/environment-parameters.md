# Hợp đồng: tệp tham số môi trường (FR-003)

Tệp: `infra/envs/staging.tfvars`, `infra/envs/production.tfvars`, mẫu `infra/envs/drill.tfvars.tmpl`.
Cùng tệp được nạp cho cả hai stack (`cloud` và `platform`). Hai stack khai báo cùng một bộ biến trong tệp
`variables.shared.tf`; `pnpm infra check` báo lỗi nếu hai bản của tệp này khác nhau từng byte.

**Không khóa nào là bí mật.** `pnpm check:secrets` quét các tệp này.

## 1. Khóa được phép khác nhau giữa hai môi trường

Cột "FR-003" là nhóm khác biệt mà đặc tả cho phép.

| Khóa | FR-003 | `staging` (khởi đầu) | `production` (khởi đầu) |
|---|---|---|---|
| `environment` | định danh | `"staging"` | `"production"` |
| `project_id` | định danh | project thử nghiệm | project phát hành |
| `network_cidr`, `subnet_cidr` | định danh | `10.20.0.0/16` | `10.10.0.0/16` |
| `base_domain` | tên miền | `staging.<gốc>` | `<gốc>` |
| `cdn_cname_target` | tên miền | tên miền CDN cấp cho thử nghiệm | tên miền CDN cấp cho phát hành |
| `node_groups` | kích thước và số máy | 1 × 4 vCPU / 8 GB, đĩa 50 GB | 2 × 4 vCPU / 8 GB, đĩa 80 GB |
| `db_instances` | số bản CSDL | `1` | `2` |
| `db_storage_gb` | kích thước | `10` | `20` |
| `db_resources` | kích thước | 0,5 CPU / 1 GB | 1 CPU / 2 GB |
| `db_backup_retention_days` | thời gian giữ sao lưu | `3` | `30` |
| `deletion_protection` | mức bảo vệ xóa | `false` | `true` |
| `admin_cidrs` | người được truy cập quản trị | địa chỉ của người vận hành | địa chỉ của người vận hành |
| `kms_key_id` | định danh | khóa thử nghiệm | khóa phát hành |
| `mail_capture_enabled` | FR-029 | `true` | `false` (ép) |
| `search_indexing` | FR-029 | `false` (ép) | `true` |
| `powered` | FR-034 | `true` / `false` | `true` (ép) |
| `power_lock` | FR-034 | `false`; `true` trong lúc Meta xét duyệt | không áp dụng |
| `staging_keep_db_volume` | FR-034 | `true` | không áp dụng |
| `staging_max_vcpu` | FR-003 (kích thước) | `8` | không áp dụng |

Khóa "không áp dụng" ở phát hành được phép vắng trong `production.tfvars`; khi đó so với mặc định của biến. `STAGING_ALLOW_FAKES` không phải tham số Terraform: đặt trong kê khai triển khai của thử nghiệm (`overlays/staging/config.env`), phát hành không đặt.

## 2. Khóa phải giống nhau ở hai môi trường

`pnpm infra check` báo lỗi nếu khác.

| Khóa | Giá trị khởi đầu | Ghi chú |
|---|---|---|
| `name_prefix` | chốt khi khởi tạo | |
| `region` | vùng HCM của nhà cung cấp | Thuộc `allowed_regions` |
| `kubernetes_version` | bản VKS ổn định mới nhất lúc dựng | FR-002 "cùng phiên bản" |
| `db_variant` | `"cnpg"` | FR-012 |
| `postgres_major` | `17` | FR-011 |
| `db_max_connections` | `220` | FR-015, research R6 |
| `db_archive_timeout` | `"5min"` | Mất dữ liệu ≤ 5 phút |
| `media_retention` | `{ noncurrent_days = 7, multipart_abort_days = 7, tmp_days = 1 }` | FR-016 |
| `media_cdn_enabled` | `false` | FR-020, chờ V3 |
| `chart_versions` | map phiên bản biểu đồ Helm (lối vào, cert-manager, CloudNativePG, trình cắm sao lưu) | Cố định – nguyên tắc IX |
| `image_versions` | map ảnh phụ trợ (PostgreSQL, Mailpit) kèm digest | Cố định |
| `acme_email` | email nhận thông báo chứng chỉ | |
| `monitoring_reserved` | `{ cpu, memory, storage_gb }` | Chỗ dành cho H3 |
| `allowed_regions` | mặc định do module đặt | Chỉ vùng trong nước |
| `registry` | địa chỉ ảnh `server` / `web` | Kho ảnh dùng chung (FR-009) |
| `environment_kind`, `labels` | không khai trong tệp thường | `environment_kind` do `drill start` đặt; `labels` có mặc định |

## 3. Kiểm tra (`validation`) trong mã

| Quy tắc | Kết quả khi vi phạm |
|---|---|
| `environment ∈ {staging, production, drill}` | Lỗi lập kế hoạch |
| `region ∈ allowed_regions` | Lỗi (FR-007) |
| `admin_cidrs` khác rỗng, không chứa `/0` | Lỗi (FR-009) |
| `production`: `powered`, `deletion_protection` mặc định `true`, `mail_capture_enabled = false`, tổng `node_groups.count ≥ 2`, `db_instances ≥ 2`, `db_backup_retention_days ≥ 30` | Lỗi |
| `staging`: `search_indexing = false`, `db_backup_retention_days ≥ 3`, tổng CPU nhóm máy ≤ `staging_max_vcpu` (trần chi phí – Edge Cases) | Lỗi |
| `db_variant = "managed"` mà thiếu `managed_db` | Lỗi |
| `network_cidr` của hai môi trường trùng nhau | Lỗi ở `pnpm infra check` (so hai tệp) |

## 4. Tên miền suy ra từ `base_domain`

| Mục đích | Tên | Bản ghi DNS (tạo tay) |
|---|---|---|
| Giao diện | `app.<base_domain>` | `CNAME` → tên miền CDN cấp |
| API | `api.<base_domain>` | `A` → `ingress.public_ip` |
| Nguồn của CDN | `origin-app.<base_domain>` | `A` → `ingress.public_ip` |
| Media qua CDN (khi bật) | `media.<base_domain>` | `CNAME` → tên miền CDN cấp |

Phát hành: `app.<gốc>`, `api.<gốc>`. Thử nghiệm: `app.staging.<gốc>`, `api.staging.<gốc>`.
Giao diện và API cùng miền đăng ký nên cookie `SameSite=Lax` của phiên vẫn được gửi; `CORS_ORIGINS` và
`WEB_ORIGINS` đặt bằng nguồn gốc của giao diện.

## 5. Tệp cấu hình backend

`infra/envs/<env>.backend.hcl` (không bí mật):

```hcl
bucket = "<prefix>-tfstate-<env>"
region = "<vùng>"
endpoints = { s3 = "https://<điểm cuối kho tệp>" }
use_lockfile = true
# các cờ bỏ kiểm tra riêng của AWS
```

`key` do CLI truyền theo stack (`cloud.tfstate` / `platform.tfstate`, hoặc `drill/…`).
