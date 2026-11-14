# Nhóm máy của cụm (T032). Khi `powered = false` không có nhóm máy nào (máy về 0, hết tính tiền máy); cụm, cân bằng
# tải, bucket, đĩa giữ nguyên nên địa chỉ lối vào không đổi (R11). Bật lại = tạo lại nhóm máy (~10–15 phút).
# V13 (chưa xác minh): nếu `num_nodes = 0` hợp lệ và rẻ hơn thì đổi sang cách đó, không đổi hợp đồng.

# VKS bắt buộc nhóm máy có khóa SSH. Chỉ khóa CÔNG KHAI nằm trong mã; cổng 22 vẫn đóng.
resource "vngcloud_vserver_sshkey" "nodes" {
  name       = "${local.name}-nodes"
  project_id = var.project_id
  public_key = var.node_ssh_public_key
}

resource "vngcloud_vks_cluster_node_group" "this" {
  for_each = var.powered ? var.node_groups : {}

  cluster_id = vngcloud_vks_cluster.this.id
  name       = "${local.name}-${each.key}"
  ssh_key_id = vngcloud_vserver_sshkey.nodes.id

  num_nodes = each.value.count
  flavor_id = each.value.flavor
  disk_size = each.value.disk_gb
  disk_type = each.value.disk_type
  image_id  = each.value.image_id

  subnet_id            = vngcloud_vserver_subnet.nodes.id
  security_groups      = [vngcloud_vserver_secgroup.nodes.id]
  enable_private_nodes = false

  # Mã hóa đĩa máy khi lưu theo kết quả V9 (cùng cờ với StorageClass).
  enabled_encryption_volume = var.storage_class_encrypted

  tags = merge(local.base_labels, { component = "node-group" })
}
