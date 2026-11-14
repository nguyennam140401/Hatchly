variable "environment" {
  type        = string
  description = "staging, production hoặc drill."
}

variable "environment_kind" {
  type        = string
  default     = "standard"
  description = "standard hoặc restore_drill (không cài lối vào)."
}

variable "name_prefix" {
  type        = string
  description = "Tiền tố; dùng làm nhãn project."
}

variable "labels" {
  type        = map(string)
  default     = {}
  description = "Nhãn thêm vào nhãn bắt buộc project/environment/component."
}

variable "mail_capture_enabled" {
  type        = bool
  default     = false
  description = "Bật Mailpit bắt thư (chỉ thử nghiệm)."
}

variable "search_indexing" {
  type        = bool
  default     = false
  description = "false → lối vào thêm X-Robots-Tag: noindex, nofollow."
}

variable "chart_versions" {
  type        = map(string)
  description = "Phiên bản biểu đồ Helm cố định: ingress, cert_manager."
}

variable "image_versions" {
  type        = map(string)
  default     = {}
  description = "Ảnh phụ trợ theo digest: mailpit."
}

variable "acme_email" {
  type        = string
  description = "Email nhận thông báo chứng chỉ."
}

variable "monitoring_reserved" {
  type = object({
    cpu        = string
    memory     = string
    storage_gb = number
  })
  description = "Chỗ dành cho giám sát (H3): chỉ ResourceQuota."
}

variable "ingress_service_annotations" {
  type        = map(string)
  default     = {}
  description = "Chú thích riêng của nhà cung cấp cho dịch vụ lối vào – chỗ DUY NHẤT nhận thứ riêng của nhà cung cấp, dưới dạng dữ liệu."
}

variable "egress_allowed_cidrs" {
  type        = list(string)
  default     = []
  description = "Chỉ restore_drill: dải được đi ra ngoài cụm (mạng của cụm, kho tệp, kho ảnh)."
}

locals {
  base_labels = merge(var.labels, {
    project     = var.name_prefix
    environment = var.environment
  })

  namespaces = merge(
    {
      app            = { data = false }
      database       = { data = true }
      monitoring     = { data = false }
      ingress        = { data = false }
      "cert-manager" = { data = false }
      "cnpg-system"  = { data = false }
    },
    var.mail_capture_enabled ? { "mail-capture" = { data = false } } : {},
  )

  create_ingress = var.environment_kind != "restore_drill"
  is_drill       = var.environment_kind == "restore_drill"
}
