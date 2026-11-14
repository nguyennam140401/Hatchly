# Stack `cloud`: hạ tầng đám mây của một môi trường (mạng, cụm, cân bằng tải, kho tệp) qua lớp nhà cung cấp.
# Cùng mã cho staging và production; khác nhau ở infra/envs/<env>.tfvars (FR-002).

# Chứng thực của tài khoản dịch vụ do `pnpm infra` truyền qua biến môi trường của tiến trình (TF_VAR_…); không
# nằm trong tệp tham số và không có giá trị mặc định.
variable "vngcloud_client_id" {
  type        = string
  sensitive   = true
  description = "Mã khách của tài khoản dịch vụ VNG Cloud (TF_VAR_vngcloud_client_id do CLI đặt)."
}

variable "vngcloud_client_secret" {
  type        = string
  sensitive   = true
  description = "Bí mật của tài khoản dịch vụ VNG Cloud (TF_VAR_vngcloud_client_secret do CLI đặt)."
}

variable "drill_source_backup_bucket" {
  type        = string
  default     = null
  description = "Chỉ môi trường tạm diễn tập: TÊN bucket sao lưu của môi trường nguồn (chỉ đọc). `pnpm infra drill start` truyền vào."
}

provider "vngcloud" {
  client_id     = var.vngcloud_client_id
  client_secret = var.vngcloud_client_secret
}

# vStorage nói giao diện S3: provider `aws` chỉ để quản lý bucket; khóa truy cập đọc từ AWS_ACCESS_KEY_ID /
# AWS_SECRET_ACCESS_KEY của tiến trình. Các cờ `skip_*` vì vStorage không phải AWS.
provider "aws" {
  region = var.region

  endpoints {
    s3 = var.object_storage_endpoint
  }

  s3_use_path_style           = var.object_storage_path_style
  skip_credentials_validation = true
  skip_region_validation      = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
}

module "provider" {
  source = "../../modules/provider-vngcloud"

  environment      = var.environment
  environment_kind = var.environment_kind
  name_prefix      = var.name_prefix
  project_id       = var.project_id
  region           = var.region
  allowed_regions  = var.allowed_regions

  network_cidr = var.network_cidr
  subnet_cidr  = var.subnet_cidr
  admin_cidrs  = var.admin_cidrs

  kubernetes_version  = var.kubernetes_version
  node_groups         = var.node_groups
  node_ssh_public_key = var.node_ssh_public_key
  powered             = var.powered

  web_origins           = ["https://app.${var.base_domain}"]
  media_retention       = var.media_retention
  backup_bucket_enabled = var.db_variant == "cnpg"

  db_variant          = var.db_variant
  managed_db          = var.managed_db
  deletion_protection = var.deletion_protection
  kms_key_id          = var.kms_key_id
  labels              = var.labels

  lb_package_id             = var.lb_package_id
  object_storage_endpoint   = var.object_storage_endpoint
  object_storage_path_style = var.object_storage_path_style
  storage_class             = var.storage_class
  storage_class_encrypted   = var.storage_class_encrypted
  drill_egress_cidrs        = var.drill_egress_cidrs
  source_backup_bucket      = var.drill_source_backup_bucket
}
