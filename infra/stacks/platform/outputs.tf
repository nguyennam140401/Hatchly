# Đầu ra bàn giao cho H2/H3 – contracts/handoff-outputs.md mục 1. KHÔNG giá trị bí mật nào (bí mật chỉ xuất hiện dưới
# dạng tên Secret + tên khóa); không `output` nào `sensitive`.

locals {
  web_host    = "app.${var.base_domain}"
  api_host    = "api.${var.base_domain}"
  origin_host = "origin-app.${var.base_domain}"

  database = var.db_variant == "cnpg" ? {
    host    = module.database[0].host
    port    = module.database[0].port
    name    = module.database[0].name
    sslmode = module.database[0].sslmode
    } : {
    host    = "pg-rw.${module.base.namespaces.database}.svc"
    port    = 5432
    name    = "app"
    sslmode = "require"
  }
}

output "environment" {
  description = "Tên môi trường."
  value       = var.environment
}

output "cluster" {
  description = "Cụm Kubernetes (tên, địa chỉ phần điều khiển)."
  value = {
    name     = local.cloud.cluster.name
    endpoint = local.cloud.cluster.endpoint
  }

  # FR-011: dữ liệu ở production phải nằm trên đĩa mã hóa khi lưu (V9). Chưa đạt thì dừng ở bước lập kế hoạch.
  precondition {
    condition     = var.environment != "production" || local.cloud.cluster.storage_class_encrypted
    error_message = "Đĩa chưa mã hóa khi lưu – xem V9 (FR-011)."
  }
}

output "namespaces" {
  description = "Không gian tên."
  value       = module.base.namespaces
}

output "urls" {
  description = "Địa chỉ giao diện, API và nguồn gốc cho CDN."
  value = {
    web             = "https://${local.web_host}"
    api             = "https://${local.api_host}"
    web_origin_host = local.origin_host
  }
}

output "ingress" {
  description = "Lối vào."
  value = {
    public_ip      = local.cloud.ingress.public_ip
    class          = module.base.ingress.class
    cluster_issuer = module.base.ingress.cluster_issuer
  }
}

# Bản ghi DNS tạo tay (hướng dẫn 03): phần trỏ về lối vào từ `cloud` + CNAME giao diện về CDN.
output "dns_records" {
  description = "Bản ghi DNS cần tạo."
  value = concat(
    local.cloud.dns_records,
    [{ name = local.web_host, type = "CNAME", value = var.cdn_cname_target }],
  )
}

output "database" {
  description = "Địa chỉ CSDL cho ứng dụng (không có mật khẩu)."
  value       = local.database
}

output "storage" {
  description = "Kho tệp cho ứng dụng (S3_*). public_endpoint trùng endpoint đến khi bật CDN/điểm cuối công khai riêng."
  value = {
    endpoint         = local.cloud.object_storage.endpoint
    public_endpoint  = local.cloud.object_storage.endpoint
    region           = local.cloud.object_storage.region
    bucket           = local.cloud.object_storage.media_bucket
    force_path_style = local.cloud.object_storage.force_path_style
  }
}

output "kms" {
  description = "Khóa KMS."
  value       = local.cloud.kms
}

output "secrets" {
  description = "Tên Secret (không giá trị)."
  value       = module.base.secrets
}

output "service_accounts" {
  description = "Tên ServiceAccount."
  value       = module.base.service_accounts
}

output "registry" {
  description = "Địa chỉ ảnh dùng chung."
  value       = var.registry
}

output "monitoring" {
  description = "Chỗ dành cho giám sát (H3)."
  value       = module.base.monitoring
}

output "mail_capture" {
  description = "Gợi ý SMTP của Mailpit (chỉ thử nghiệm)."
  value       = module.base.mail_capture
}
