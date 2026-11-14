# Đầu vào của module – contracts/provider-layer.md mục 2. KHÔNG có biến chứng thực: provider lấy khóa từ biến
# môi trường của tiến trình (hợp đồng mục 2, đoạn cuối).

variable "environment" {
  type        = string
  description = "staging, production hoặc drill."

  validation {
    condition     = contains(["staging", "production", "drill"], var.environment)
    error_message = "environment phải là staging, production hoặc drill."
  }
}

variable "environment_kind" {
  type        = string
  default     = "standard"
  description = "standard hoặc restore_drill (môi trường tạm diễn tập khôi phục)."

  validation {
    condition     = contains(["standard", "restore_drill"], var.environment_kind)
    error_message = "environment_kind phải là standard hoặc restore_drill."
  }
}

variable "name_prefix" {
  type        = string
  description = "Tiền tố tên tài nguyên."
}

variable "project_id" {
  type        = string
  description = "Mã project của môi trường."
}

variable "region" {
  type        = string
  description = "Vùng; phải thuộc allowed_regions."

  validation {
    condition     = contains(var.allowed_regions, var.region)
    error_message = "region không thuộc allowed_regions: dữ liệu chỉ được đặt ở vùng trong nước (FR-007)."
  }
}

variable "allowed_regions" {
  type        = list(string)
  default     = ["HCM03", "HCM04", "HAN01"]
  description = "Chỉ vùng trong nước."
}

variable "network_cidr" {
  type        = string
  description = "Dải mạng; không trùng giữa các môi trường."
}

variable "subnet_cidr" {
  type        = string
  description = "Dải mạng con của máy."
}

variable "pod_cidr" {
  type        = string
  default     = "172.16.0.0/16"
  description = "Dải địa chỉ của pod trong cụm; không giao với network_cidr."
}

variable "admin_cidrs" {
  type        = list(string)
  description = "Địa chỉ được gọi API cụm. Không rỗng, không chứa /0."

  validation {
    condition     = length(var.admin_cidrs) > 0 && alltrue([for c in var.admin_cidrs : !endswith(c, "/0")])
    error_message = "admin_cidrs phải khác rỗng và không chứa dải /0 (FR-009)."
  }
}

variable "kubernetes_version" {
  type        = string
  description = "Phiên bản Kubernetes của VKS."
}

variable "node_groups" {
  type = map(object({
    flavor    = string
    count     = number
    vcpu      = number
    disk_gb   = number
    zones     = optional(list(string), [])
    disk_type = optional(string)
    image_id  = optional(string)
  }))
  description = "Nhóm máy. flavor là mã flavor của VKS."

  validation {
    condition     = var.environment != "production" || sum([for g in values(var.node_groups) : g.count]) >= 2
    error_message = "production: tổng số máy phải ≥ 2 (FR-008)."
  }
}

variable "node_ssh_public_key" {
  type        = string
  description = "Khóa SSH công khai gắn vào máy (VKS bắt buộc; cổng 22 vẫn đóng)."
}

variable "powered" {
  type        = bool
  default     = true
  description = "false → không có nhóm máy nào; cụm, cân bằng tải, bucket, đĩa vẫn còn."

  validation {
    condition     = var.environment != "production" || var.powered
    error_message = "production: powered phải là true."
  }
}

variable "web_origins" {
  type        = list(string)
  description = "Nguồn gốc giao diện cho CORS của bucket media. Cấm `*`."

  validation {
    condition     = alltrue([for o in var.web_origins : o != "*" && !strcontains(o, "*")])
    error_message = "web_origins không được chứa ký tự đại diện `*`."
  }
}

variable "media_retention" {
  type = object({
    noncurrent_days      = number
    multipart_abort_days = number
    tmp_days             = number
  })
  default = {
    noncurrent_days      = 7
    multipart_abort_days = 7
    tmp_days             = 1
  }
  description = "Luật vòng đời bucket media."
}

variable "backup_bucket_enabled" {
  type        = bool
  default     = true
  description = "true khi db_variant = cnpg."
}

variable "source_backup_bucket" {
  type        = string
  default     = null
  description = "Chỉ restore_drill: TÊN bucket sao lưu của môi trường nguồn (chỉ để đọc). Ngoại lệ duy nhất cho bất biến 10."
}

variable "db_variant" {
  type        = string
  default     = "cnpg"
  description = "cnpg hoặc managed."

  validation {
    condition     = contains(["cnpg", "managed"], var.db_variant)
    error_message = "db_variant phải là cnpg hoặc managed."
  }
}

variable "managed_db" {
  type = object({
    host = string
    port = optional(number, 5432)
  })
  default     = null
  description = "Chỉ khi db_variant = managed."
}

variable "deletion_protection" {
  type        = bool
  default     = null
  description = "null → true ở production, false ở môi trường khác. Đặt tường minh để ghi đè."
}

variable "kms_key_id" {
  type        = string
  description = "Mã khóa KMS tạo tay; module chỉ kiểm định dạng và chuyển ra đầu ra."

  validation {
    condition     = length(trimspace(var.kms_key_id)) > 0
    error_message = "kms_key_id không được rỗng."
  }
}

variable "labels" {
  type        = map(string)
  default     = {}
  description = "Nhãn thêm vào nhãn bắt buộc project/environment/component."
}

# ----- Ngoài hợp đồng gốc (007 thêm vì provider VNG đòi hoặc cần cho đầu ra) -----

variable "lb_package_id" {
  type        = string
  description = "Mã gói cân bằng tải của nhà cung cấp."
}

variable "object_storage_endpoint" {
  type        = string
  description = "Điểm cuối S3 của vStorage; chuyển ra đầu ra object_storage.endpoint."
}

variable "object_storage_path_style" {
  type        = bool
  default     = true
  description = "Địa chỉ kiểu đường dẫn; chuyển ra đầu ra object_storage.force_path_style."
}

variable "storage_class" {
  type        = string
  description = "Tên StorageClass của đĩa CSDL do nhà cung cấp cấp."
}

variable "storage_class_encrypted" {
  type        = bool
  default     = false
  description = "StorageClass có mã hóa khi lưu không (V9); chuyển ra đầu ra cluster.storage_class_encrypted."
}

variable "drill_egress_cidrs" {
  type        = list(string)
  default     = []
  description = "Chỉ restore_drill: dải địa chỉ được đi ra (kho tệp, kho ảnh). Rỗng = chặn mọi lưu lượng đi ra."
}

locals {
  name = "${var.name_prefix}-${var.environment}"

  # Nhãn bắt buộc (FR-006). `component` được ghi đè theo từng tài nguyên.
  base_labels = merge(var.labels, {
    project     = var.name_prefix
    environment = var.environment
  })

  is_drill = var.environment_kind == "restore_drill"

  # Mặc định bảo vệ xóa: bật ở production, tắt ở nơi khác, trừ khi đặt tường minh.
  deletion_protection = coalesce(var.deletion_protection, var.environment == "production")
}
