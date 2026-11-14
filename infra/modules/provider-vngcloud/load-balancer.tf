# Cân bằng tải tầng 4 công khai cho lối vào (T033, R5/R11). Tạo bằng Terraform để ĐỊA CHỈ CÔNG KHAI SỐNG QUA lần
# dựng lại cụm và lúc tắt máy thử nghiệm. Không tạo ở môi trường tạm diễn tập (không nhận lưu lượng thật).

locals {
  # Nhánh dự phòng (V8): đổi thành `false` để trình cắm VKS tự tạo cân bằng tải từ Service type=LoadBalancer.
  # Khi đó `load_balancer_id = null`, annotation rỗng; địa chỉ giữ nguyên chừng nào Service còn.
  prebuilt_lb = true

  create_lb = local.prebuilt_lb && !local.is_drill
}

resource "vngcloud_vlb_load_balancer" "ingress" {
  count = local.create_lb ? 1 : 0

  name       = "${local.name}-ingress"
  project_id = var.project_id
  package_id = var.lb_package_id
  subnet_id  = vngcloud_vserver_subnet.nodes.id
  type       = "Layer 4"
  scheme     = "Internet"
}
