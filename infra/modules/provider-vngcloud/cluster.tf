# Cụm VKS (T032, research R5): cụm công khai + danh sách địa chỉ được gọi phần điều khiển (FR-009).
# Nhóm máy là tài nguyên TÁCH khỏi cụm (node-groups.tf) để tắt/bật được mà không đụng cụm (FR-034).

locals {
  # Phần điều khiển chỉ mở cho địa chỉ quản trị và chính mạng con của máy (để máy vào được cụm).
  api_allowlist = distinct(concat(var.admin_cidrs, [var.subnet_cidr]))
}

resource "vngcloud_vks_cluster" "this" {
  name        = "${local.name}-vks"
  description = "Cụm ${local.name} (Terraform, 007)"
  version     = var.kubernetes_version

  vpc_id    = vngcloud_vserver_network.this.id
  subnet_id = vngcloud_vserver_subnet.nodes.id
  cidr      = var.pod_cidr

  network_type                   = "CALICO"
  enable_private_cluster         = false
  white_list_node_cidr           = local.api_allowlist
  enabled_load_balancer_plugin   = true
  enabled_block_store_csi_plugin = true

  lifecycle {
    precondition {
      condition     = !contains(local.api_allowlist, "0.0.0.0/0")
      error_message = "Danh sách địa chỉ được gọi API cụm không được chứa 0.0.0.0/0."
    }
  }
}
