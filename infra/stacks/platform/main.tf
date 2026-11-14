# Stack `platform`: nền tảng Kubernetes chuẩn mở trên cụm do stack `cloud` dựng (T049). Chỉ nhận từ `cloud` các
# đầu ra theo hợp đồng lớp nhà cung cấp (đọc `terraform_remote_state`); KHÔNG có tài nguyên hay nguồn dữ liệu của
# nhà cung cấp (`vngcloud_*`, `aws_*`) – đổi nhà cung cấp không đụng stack này (FR-031, SC-013).

variable "cloud_state_bucket" {
  type        = string
  default     = null
  description = "Bucket trạng thái chứa cloud.tfstate. null → <name_prefix>-tfstate-<environment>. `drill start` truyền bucket của môi trường nguồn."
}

variable "cloud_state_key" {
  type        = string
  default     = "cloud.tfstate"
  description = "Khóa trạng thái của stack cloud (drill/cloud.tfstate cho môi trường tạm)."
}

variable "drill_target_time" {
  type        = string
  default     = null
  description = "Chỉ môi trường tạm diễn tập: thời điểm đích khôi phục (RFC 3339). `pnpm infra drill start` truyền vào."
}

locals {
  cloud_state_bucket = coalesce(var.cloud_state_bucket, "${var.name_prefix}-tfstate-${var.environment}")
  cloud              = data.terraform_remote_state.cloud.outputs
  is_drill           = var.environment_kind == "restore_drill"
}

data "terraform_remote_state" "cloud" {
  backend = "s3"

  config = {
    bucket = local.cloud_state_bucket
    key    = var.cloud_state_key
    region = var.region

    endpoints = {
      s3 = var.object_storage_endpoint
    }

    use_path_style              = var.object_storage_path_style
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}

# Kubeconfig do `pnpm infra` đặt qua KUBECONFIG / KUBE_CONFIG_PATH (infra/.credentials/<env>.kubeconfig); không dùng
# token hay chứng chỉ lấy từ đầu ra (kubeconfig không phải đầu ra – hợp đồng lớp nhà cung cấp mục 3).
provider "kubernetes" {}

provider "helm" {}

module "base" {
  source = "../../modules/platform-base"

  environment      = var.environment
  environment_kind = var.environment_kind
  name_prefix      = var.name_prefix
  labels           = var.labels

  mail_capture_enabled = var.mail_capture_enabled
  search_indexing      = var.search_indexing
  chart_versions       = var.chart_versions
  image_versions       = var.image_versions
  acme_email           = var.acme_email
  monitoring_reserved  = var.monitoring_reserved

  # Môi trường tạm diễn tập: chặn đi ra ngoài trừ mạng của cụm và các dải khai báo.
  egress_allowed_cidrs = concat([var.subnet_cidr], var.drill_egress_cidrs)

  ingress_service_annotations = local.cloud.ingress.service_annotations
}

module "database" {
  source = "../../modules/database-cnpg"
  count  = var.db_variant == "cnpg" ? 1 : 0

  chart_versions = var.chart_versions

  instances       = var.db_instances
  storage_gb      = var.db_storage_gb
  storage_class   = local.cloud.cluster.storage_class
  resources       = var.db_resources
  postgres_image  = var.image_versions["postgres"]
  max_connections = var.db_max_connections
  archive_timeout = var.db_archive_timeout

  backup_bucket  = local.cloud.object_storage.backup_bucket
  s3_endpoint    = local.cloud.object_storage.endpoint
  s3_region      = local.cloud.object_storage.region
  retention_days = var.db_backup_retention_days

  deletion_protection = var.deletion_protection

  # Môi trường tạm diễn tập: khôi phục từ sao lưu của môi trường nguồn (chỉ đọc), không lưu WAL/sao lưu của chính nó.
  mode     = local.is_drill ? "recovery" : "standard"
  recovery = local.is_drill ? { target_time = var.drill_target_time } : null
  labels   = merge(var.labels, { project = var.name_prefix, environment = var.environment })

  depends_on = [module.base]
}

# Nhánh `managed` (khai sẵn, KHÔNG kích hoạt – chờ V1): Service ExternalName cùng tên `pg-rw` để ứng dụng không đổi.
resource "kubernetes_service_v1" "pg_rw_external" {
  count = var.db_variant == "managed" && var.managed_db != null ? 1 : 0

  metadata {
    name      = "pg-rw"
    namespace = module.base.namespaces.database
  }

  spec {
    type          = "ExternalName"
    external_name = var.managed_db.host
  }

  lifecycle {
    precondition {
      condition     = var.db_variant != "managed"
      error_message = "Biến thể managed chưa hiện thực – chờ V1 (research R6). Dùng db_variant = \"cnpg\"."
    }
  }
}
