# Tham số môi trường PHÁT HÀNH (contracts/environment-parameters.md). Không có bí mật nào trong tệp này.
# Giá trị dạng "TODO-P6-…" chỉ biết sau khi có tài khoản VNG Cloud (P6) – điền khi làm danh sách khởi tạo.
# Các khóa "không áp dụng" (power_lock, staging_keep_db_volume, staging_max_vcpu) cố ý vắng: so với mặc định.

# ----- Khác biệt được phép (FR-003) -----
environment = "production"
project_id  = "TODO-P6-project-production" # mã project phát hành

network_cidr = "10.10.0.0/16"
subnet_cidr  = "10.10.1.0/24"

base_domain      = "TODO-P6-base-domain" # tên miền gốc (app.<gốc>, api.<gốc>)
cdn_cname_target = "TODO-P6-cdn-production"

# 2 máy 4 vCPU / 8 GB, đĩa 80 GB. `zones` để trống cho đến khi V12 cho biết số vùng sẵn sàng (khi có ≥ 2 vùng
# thì điền, vd zones = ["…-1a", "…-1b"], để mất một vùng vẫn còn máy).
node_groups = {
  default = {
    flavor  = "TODO-P6-flavor-4vcpu-8gb"
    count   = 2
    vcpu    = 4
    disk_gb = 80
    zones   = []
  }
}

db_instances             = 2
db_storage_gb            = 20
db_resources             = { cpu = "1", memory = "2Gi" }
db_backup_retention_days = 30
deletion_protection      = true

# Địa chỉ người vận hành được gọi API cụm. 203.0.113.10/32 là dải tài liệu: thay bằng địa chỉ thật (P6).
admin_cidrs = ["203.0.113.10/32"]
kms_key_id  = "TODO-P6-kms-production"

mail_capture_enabled = false
search_indexing      = true
powered              = true

# ----- Phải giống hệt staging (hai bản được so với nhau) -----
name_prefix        = "app"
region             = "HCM03"
kubernetes_version = "TODO-P6-kubernetes-version"

# Khóa SSH CÔNG KHAI cho máy (cổng 22 vẫn đóng); khóa riêng cất kỹ, không dùng. Thay bằng khóa thật (P6).
node_ssh_public_key = "ssh-ed25519 TODO-P6-public-key"
# Mã gói cân bằng tải (tra từ danh sách gói của nhà cung cấp lúc P6).
lb_package_id = "TODO-P6-lb-package"

# vStorage: điểm cuối S3 và kiểu địa chỉ – xác nhận theo V5.
object_storage_endpoint   = "https://hcm03.vstorage.vngcloud.vn"
object_storage_path_style = true

# StorageClass của đĩa CSDL. storage_class_encrypted = true chỉ khi V9 xác nhận mã hóa khi lưu; production
# ÉP true (FR-011) nên `plan production` sẽ dừng cho đến khi V9 đạt.
storage_class           = "TODO-P6-storage-class"
storage_class_encrypted = false

db_variant         = "cnpg"
postgres_major     = 17
db_max_connections = 220
db_archive_timeout = "5min"

media_retention = {
  noncurrent_days      = 7
  multipart_abort_days = 7
  tmp_days             = 1
}
media_cdn_enabled = false

chart_versions = {
  ingress      = "2.8.1"   # nginx-ingress của F5/NGINX, https://helm.nginx.com/stable
  cert_manager = "v1.21.3" # https://charts.jetstack.io
  cnpg         = "0.29.1"  # cloudnative-pg, https://cloudnative-pg.github.io/charts
  barman_cloud = "0.9.0"   # plugin-barman-cloud, cùng kho biểu đồ với cnpg
}

image_versions = {
  postgres = "ghcr.io/cloudnative-pg/postgresql:17-standard-bookworm@sha256:0639bd0d131295e149a6ab187dd0b3818ec12d6a32c83159b830d5c5bbf29949"
  mailpit  = "docker.io/axllent/mailpit:v1.27@sha256:e22dce5b36f93c77082e204a3942fb6b283b7896e057458400a4c88344c3df68"
}

acme_email = "TODO-P6-acme-email"

monitoring_reserved = {
  cpu        = "2"
  memory     = "4Gi"
  storage_gb = 100
}

registry = {
  server_image = "vcr.vngcloud.vn/TODO-P6-registry/server"
  web_image    = "vcr.vngcloud.vn/TODO-P6-registry/web"
}
