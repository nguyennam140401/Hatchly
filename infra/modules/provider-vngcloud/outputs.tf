# Đầu ra của module – HỢP ĐỒNG CỐ ĐỊNH (contracts/provider-layer.md mục 3). Không đầu ra nào `sensitive`;
# kubeconfig KHÔNG là đầu ra (lấy bằng `pnpm infra kubeconfig <env>`).

locals {
  # Chứng chỉ CA là thông tin công khai; lấy từ kubeconfig do nhà cung cấp trả, không lộ khóa khách hàng.
  cluster_ca = try(
    base64decode(yamldecode(vngcloud_vks_cluster.this.config).clusters[0].cluster["certificate-authority-data"]),
    null,
  )
}

output "cluster" {
  description = "Cụm Kubernetes."
  value = {
    endpoint                = try(yamldecode(vngcloud_vks_cluster.this.config).clusters[0].cluster.server, null)
    ca_certificate          = local.cluster_ca
    name                    = vngcloud_vks_cluster.this.name
    id                      = vngcloud_vks_cluster.this.id
    storage_class           = var.storage_class
    storage_class_encrypted = var.storage_class_encrypted
  }
}

output "ingress" {
  description = "Lối vào công khai. load_balancer_id = null khi để trình cắm VKS tự tạo cân bằng tải."
  value = {
    public_ip        = local.create_lb ? vngcloud_vlb_load_balancer.ingress[0].address : null
    load_balancer_id = local.create_lb ? vngcloud_vlb_load_balancer.ingress[0].id : null
    service_annotations = local.create_lb ? {
      "vks.vngcloud.vn/load-balancer-id" = vngcloud_vlb_load_balancer.ingress[0].id
    } : {}
  }
}

output "object_storage" {
  description = "Kho tệp. Môi trường tạm diễn tập: không bucket mới, backup_bucket là bucket của môi trường nguồn (chỉ đọc)."
  value = {
    endpoint         = var.object_storage_endpoint
    region           = var.region
    force_path_style = var.object_storage_path_style
    media_bucket     = local.create_buckets ? aws_s3_bucket.media[0].bucket : null
    backup_bucket    = local.is_drill ? var.source_backup_bucket : (local.create_backup_bucket ? aws_s3_bucket.backup[0].bucket : null)
  }
}

output "database" {
  description = "CSDL: biến thể và (nhánh managed) địa chỉ dịch vụ quản lý sẵn."
  value = {
    variant      = var.db_variant
    managed_host = var.db_variant == "managed" && var.managed_db != null ? var.managed_db.host : null
    managed_port = var.db_variant == "managed" && var.managed_db != null ? var.managed_db.port : null
  }
}

output "kms" {
  description = "Khóa KMS tạo tay."
  value = {
    key_id = var.kms_key_id
  }
}

output "network" {
  description = "Mạng (tham khảo)."
  value = {
    id        = vngcloud_vserver_network.this.id
    subnet_id = vngcloud_vserver_subnet.nodes.id
  }
}

output "labels" {
  description = "Nhãn bắt buộc cho tài nguyên của platform."
  value       = merge(local.base_labels, { component = "platform" })
}
