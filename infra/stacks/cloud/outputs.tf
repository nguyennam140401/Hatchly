# Đầu ra của stack `cloud` – chuyển tiếp nguyên hợp đồng của lớp nhà cung cấp (contracts/provider-layer.md mục 3)
# cho stack `platform` đọc qua `terraform_remote_state`, cộng bản ghi DNS phần trỏ về địa chỉ lối vào.
# Không đầu ra nào `sensitive`.

output "cluster" {
  description = "Cụm Kubernetes."
  value       = module.provider.cluster
}

output "ingress" {
  description = "Lối vào công khai."
  value       = module.provider.ingress
}

output "object_storage" {
  description = "Kho tệp."
  value       = module.provider.object_storage
}

output "database" {
  description = "CSDL (biến thể và địa chỉ dịch vụ quản lý sẵn)."
  value       = module.provider.database
}

output "kms" {
  description = "Khóa KMS."
  value       = module.provider.kms
}

output "network" {
  description = "Mạng."
  value       = module.provider.network
}

output "labels" {
  description = "Nhãn bắt buộc."
  value       = module.provider.labels
}

# Bản ghi DNS tạo tay ở nhà đăng ký tên miền (hướng dẫn 03). Phần CNAME giao diện → CDN nằm ở stack platform.
output "dns_records" {
  description = "Bản ghi DNS phần trỏ về địa chỉ công khai của lối vào."
  value = [
    { name = "api.${var.base_domain}", type = "A", value = module.provider.ingress.public_ip },
    { name = "origin-app.${var.base_domain}", type = "A", value = module.provider.ingress.public_ip },
  ]
}
