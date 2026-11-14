variable "chart_versions" {
  type        = map(string)
  description = "Phiên bản biểu đồ Helm cố định: cnpg, barman_cloud."
}

variable "instances" {
  type        = number
  description = "Số bản CSDL (1 chính + bản dự phòng)."
}

variable "storage_gb" {
  type        = number
  description = "Dung lượng đĩa mỗi bản (GB)."
}

variable "storage_class" {
  type        = string
  description = "Tên StorageClass do lớp nhà cung cấp cấp."
}

variable "resources" {
  type = object({
    cpu    = string
    memory = string
  })
  description = "Tài nguyên mỗi bản (requests = limits)."
}

variable "postgres_image" {
  type        = string
  description = "Ảnh PostgreSQL 17 theo digest."

  validation {
    condition     = strcontains(var.postgres_image, "@sha256:")
    error_message = "postgres_image phải tham chiếu theo digest (@sha256:…) – nguyên tắc IX."
  }
}

variable "max_connections" {
  type        = number
  default     = 220
  description = "max_connections (research R6)."
}

variable "archive_timeout" {
  type        = string
  default     = "5min"
  description = "archive_timeout: mất dữ liệu tối đa trong khoảng này."
}

variable "backup_bucket" {
  type        = string
  description = "Tên bucket sao lưu (chế độ standard) hoặc bucket NGUỒN chỉ đọc (chế độ recovery)."
}

variable "s3_endpoint" {
  type        = string
  description = "Điểm cuối S3 của vStorage."
}

variable "s3_region" {
  type        = string
  description = "Vùng S3."
}

variable "retention_days" {
  type        = number
  default     = 30
  description = "Số ngày giữ sao lưu."
}

variable "deletion_protection" {
  type        = bool
  default     = true
  description = "Gắn chú thích chống xóa cho Cluster."
}

variable "mode" {
  type        = string
  default     = "standard"
  description = "standard (cụm mới + sao lưu liên tục) hoặc recovery (khôi phục từ sao lưu nguồn, môi trường tạm)."

  validation {
    condition     = contains(["standard", "recovery"], var.mode)
    error_message = "mode phải là standard hoặc recovery."
  }
}

variable "recovery" {
  type = object({
    target_time = string
    server_name = optional(string, "pg")
  })
  default     = null
  description = "Chỉ mode = recovery: thời điểm đích (RFC 3339) và tên server trong bucket nguồn."

  validation {
    condition     = var.mode != "recovery" || var.recovery != null
    error_message = "mode = recovery thì phải khai recovery."
  }
}

variable "labels" {
  type        = map(string)
  default     = {}
  description = "Nhãn thêm."
}
