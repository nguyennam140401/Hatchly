# Mạng, mạng con và nhóm bảo mật của máy (T031). Nhóm bảo mật chỉ nhận lưu lượng vào từ trong mạng con (nơi cân
# bằng tải đứng) – KHÔNG mở cổng 22 hay 5432 ra internet.
# Ghi chú nhãn: tài nguyên mạng của VNG không có thuộc tính `tags`; nhãn nằm ở tên `<prefix>-<env>-<thành phần>`.

resource "vngcloud_vserver_network" "this" {
  name       = "${local.name}-net"
  project_id = var.project_id
  cidr       = var.network_cidr
}

resource "vngcloud_vserver_subnet" "nodes" {
  name       = "${local.name}-subnet"
  project_id = var.project_id
  network_id = vngcloud_vserver_network.this.id
  cidr       = var.subnet_cidr
}

resource "vngcloud_vserver_secgroup" "nodes" {
  name        = "${local.name}-nodes"
  project_id  = var.project_id
  description = "Máy của cụm ${local.name}: chỉ nhận lưu lượng vào từ mạng con"
}

locals {
  # Vào: mọi cổng TCP/UDP từ trong mạng con (cân bằng tải, máy với máy). Không có luật nào từ 0.0.0.0/0.
  ingress_rules = {
    subnet_tcp = { protocol = "TCP", remote = var.subnet_cidr }
    subnet_udp = { protocol = "UDP", remote = var.subnet_cidr }
  }

  # Ra: môi trường thường đi ra tự do; môi trường tạm diễn tập chỉ ra tới `drill_egress_cidrs` (kho tệp, kho ảnh).
  egress_targets = local.is_drill ? var.drill_egress_cidrs : ["0.0.0.0/0"]
  egress_rules = {
    for pair in setproduct(["TCP", "UDP"], local.egress_targets) :
    "${lower(pair[0])}_${replace(replace(pair[1], ".", "_"), "/", "_")}" => { protocol = pair[0], remote = pair[1] }
  }
}

resource "vngcloud_vserver_secgrouprule" "ingress" {
  for_each = local.ingress_rules

  project_id        = var.project_id
  security_group_id = vngcloud_vserver_secgroup.nodes.id
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = each.value.protocol
  port_range_min    = 1
  port_range_max    = 65535
  remote_ip_prefix  = each.value.remote
  description       = "Từ mạng con (${each.key})"
}

resource "vngcloud_vserver_secgrouprule" "egress" {
  for_each = local.egress_rules

  project_id        = var.project_id
  security_group_id = vngcloud_vserver_secgroup.nodes.id
  direction         = "egress"
  ethertype         = "IPv4"
  protocol          = each.value.protocol
  port_range_min    = 1
  port_range_max    = 65535
  remote_ip_prefix  = each.value.remote
  description       = "Đi ra (${each.key})"
}
