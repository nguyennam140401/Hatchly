# Biến dùng chung của hai stack (`cloud` và `platform`) – contracts/environment-parameters.md.
# Tệp này PHẢI giống nhau từng byte ở hai stack (`pnpm infra check` so sánh). Mỗi stack chỉ dùng một phần biến.
# Không biến nào là bí mật: chứng thực của provider lấy từ biến môi trường của tiến trình, không nằm ở đây.

# ----- Định danh -----

variable "environment" {
  type        = string
  description = "Tên môi trường: staging, production hoặc drill (môi trường tạm diễn tập khôi phục)."

  validation {
    condition     = contains(["staging", "production", "drill"], var.environment)
    error_message = "environment phải là staging, production hoặc drill."
  }
}

variable "environment_kind" {
  type        = string
  default     = "standard"
  description = "standard (môi trường thường) hoặc restore_drill (môi trường tạm, do `drill start` đặt)."

  validation {
    condition     = contains(["standard", "restore_drill"], var.environment_kind)
    error_message = "environment_kind phải là standard hoặc restore_drill."
  }

  validation {
    condition     = (var.environment == "drill") == (var.environment_kind == "restore_drill")
    error_message = "environment = \"drill\" khi và chỉ khi environment_kind = \"restore_drill\"."
  }
}

variable "project_id" {
  type        = string
  description = "Mã project của nhà cung cấp cho môi trường này (mỗi môi trường một project)."
}

variable "name_prefix" {
  type        = string
  description = "Tiền tố tên tài nguyên, giống nhau ở mọi môi trường."

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,15}$", var.name_prefix))
    error_message = "name_prefix gồm chữ thường, số, gạch ngang, bắt đầu bằng chữ, dài 2–16 ký tự."
  }
}

variable "labels" {
  type        = map(string)
  default     = {}
  description = "Nhãn bổ sung, gộp với nhãn bắt buộc project/environment/component."
}

# ----- Vùng và mạng -----

variable "region" {
  type        = string
  description = "Vùng của nhà cung cấp; phải thuộc allowed_regions (dữ liệu ở trong nước – ADR-10)."

  validation {
    condition     = contains(var.allowed_regions, var.region)
    error_message = "region không thuộc allowed_regions: dữ liệu chỉ được đặt ở vùng trong nước (FR-007)."
  }
}

variable "allowed_regions" {
  type        = list(string)
  default     = ["HCM03", "HCM04", "HAN01"]
  description = "Các vùng trong nước được phép."
}

variable "network_cidr" {
  type        = string
  description = "Dải mạng của môi trường; khác nhau giữa các môi trường."

  validation {
    condition     = can(cidrhost(var.network_cidr, 0))
    error_message = "network_cidr không phải CIDR hợp lệ."
  }
}

variable "subnet_cidr" {
  type        = string
  description = "Dải mạng con của máy trong cụm; nằm trong network_cidr."

  validation {
    condition     = can(cidrhost(var.subnet_cidr, 0))
    error_message = "subnet_cidr không phải CIDR hợp lệ."
  }
}

variable "admin_cidrs" {
  type        = list(string)
  description = "Địa chỉ được truy cập API cụm (người vận hành). Không được rỗng, không được chứa /0."

  validation {
    condition     = length(var.admin_cidrs) > 0
    error_message = "admin_cidrs không được rỗng: API cụm chỉ mở cho địa chỉ quản trị (FR-009)."
  }

  validation {
    condition     = alltrue([for c in var.admin_cidrs : !endswith(c, "/0")])
    error_message = "admin_cidrs không được chứa dải /0 (mở ra toàn internet)."
  }
}

variable "base_domain" {
  type        = string
  description = "Tên miền gốc của môi trường (app.<base_domain>, api.<base_domain>)."
}

variable "cdn_cname_target" {
  type        = string
  default     = ""
  description = "Tên miền CDN cấp cho app.<base_domain> (bản ghi CNAME tạo tay)."
}

# ----- Cụm Kubernetes -----

variable "kubernetes_version" {
  type        = string
  description = "Phiên bản Kubernetes của VKS; giống nhau ở hai môi trường (FR-002)."
}

variable "node_groups" {
  type = map(object({
    flavor  = string
    count   = number
    vcpu    = number
    disk_gb = number
    zones   = optional(list(string), [])
    # Tùy chọn: loại đĩa và ảnh hệ điều hành (mã của VKS); bỏ trống thì dùng mặc định của nhà cung cấp.
    disk_type = optional(string)
    image_id  = optional(string)
  }))
  description = "Nhóm máy của cụm. flavor là MÃ flavor của VKS; vcpu là số vCPU của MỘT máy (dùng cho trần chi phí thử nghiệm)."

  validation {
    condition     = var.environment != "production" || sum([for g in values(var.node_groups) : g.count]) >= 2
    error_message = "production: tổng số máy trong node_groups phải ≥ 2 (FR-008)."
  }

  validation {
    condition = (
      var.environment != "staging" ||
      sum([for g in values(var.node_groups) : g.count * g.vcpu]) <= var.staging_max_vcpu
    )
    error_message = "staging: tổng vCPU của node_groups vượt staging_max_vcpu (trần chi phí)."
  }
}

variable "node_ssh_public_key" {
  type        = string
  description = "Khóa SSH CÔNG KHAI gắn vào máy (VKS bắt buộc có khóa; cổng 22 vẫn đóng). Giữ khóa riêng ở nơi an toàn, không dùng."

  validation {
    condition     = can(regex("^(ssh-|ecdsa-)", var.node_ssh_public_key))
    error_message = "node_ssh_public_key phải là khóa SSH công khai (bắt đầu bằng ssh-… hoặc ecdsa-…)."
  }
}

variable "lb_package_id" {
  type        = string
  description = "Mã gói cân bằng tải của nhà cung cấp (tra từ danh sách gói lúc P6)."
}

variable "staging_max_vcpu" {
  type        = number
  default     = 8
  description = "Trần tổng vCPU của thử nghiệm (không áp dụng cho production)."
}

variable "powered" {
  type        = bool
  default     = true
  description = "false = nhóm máy về 0 (chỉ thử nghiệm); cụm, cân bằng tải, bucket, đĩa vẫn còn (FR-034)."

  validation {
    condition     = var.environment != "production" || var.powered
    error_message = "production: powered phải là true (FR-034 chỉ áp dụng cho thử nghiệm)."
  }
}

variable "power_lock" {
  type        = bool
  default     = false
  description = "true = từ chối tắt máy (ví dụ lúc Meta xét duyệt). Không áp dụng cho production."
}

variable "staging_keep_db_volume" {
  type        = bool
  default     = true
  description = "Giữ đĩa CSDL của thử nghiệm khi tắt máy. Không áp dụng cho production."
}

# ----- CSDL -----

variable "db_variant" {
  type        = string
  default     = "cnpg"
  description = "cnpg (CloudNativePG tự chạy) hoặc managed (dịch vụ CSDL của nhà cung cấp, chờ V1)."

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
  description = "Thông tin CSDL quản lý sẵn; bắt buộc khi db_variant = managed."

  validation {
    condition     = var.db_variant != "managed" || var.managed_db != null
    error_message = "db_variant = \"managed\" thì phải khai managed_db."
  }
}

variable "postgres_major" {
  type        = number
  default     = 17
  description = "Phiên bản chính của PostgreSQL, giống nhau ở hai môi trường."
}

variable "db_instances" {
  type        = number
  default     = 1
  description = "Số bản CSDL (1 chính + bản dự phòng)."

  validation {
    condition     = var.environment != "production" || var.db_instances >= 2
    error_message = "production: db_instances phải ≥ 2."
  }
}

variable "db_storage_gb" {
  type        = number
  default     = 10
  description = "Dung lượng đĩa mỗi bản CSDL (GB)."
}

variable "db_resources" {
  type = object({
    cpu    = string
    memory = string
  })
  default = {
    cpu    = "500m"
    memory = "1Gi"
  }
  description = "Tài nguyên mỗi bản CSDL (đơn vị Kubernetes)."
}

variable "db_max_connections" {
  type        = number
  default     = 220
  description = "max_connections của PostgreSQL (research R6)."
}

variable "db_archive_timeout" {
  type        = string
  default     = "5min"
  description = "archive_timeout: mất dữ liệu tối đa trong khoảng này (RPO ≤ 5 phút)."
}

variable "db_backup_retention_days" {
  type        = number
  default     = 30
  description = "Số ngày giữ sao lưu CSDL."

  validation {
    condition     = var.environment != "production" || var.db_backup_retention_days >= 30
    error_message = "production: db_backup_retention_days phải ≥ 30."
  }

  validation {
    condition     = var.environment != "staging" || var.db_backup_retention_days >= 3
    error_message = "staging: db_backup_retention_days phải ≥ 3."
  }
}

variable "deletion_protection" {
  type        = bool
  default     = true
  description = "Bảo vệ xóa tài nguyên chứa dữ liệu (bucket, đĩa)."
}

# ----- Kho tệp, khóa, CDN -----

variable "kms_key_id" {
  type        = string
  description = "Mã khóa KMS tạo tay; Terraform chỉ kiểm định dạng và chuyển ra đầu ra."
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
  description = "Luật vòng đời của bucket media (FR-016)."
}

variable "object_storage_endpoint" {
  type        = string
  description = "Điểm cuối S3 của vStorage (https://…); cũng là S3_ENDPOINT bàn giao cho ứng dụng."

  validation {
    condition     = startswith(var.object_storage_endpoint, "https://")
    error_message = "object_storage_endpoint phải bắt đầu bằng https://."
  }
}

variable "object_storage_path_style" {
  type        = bool
  default     = true
  description = "Dùng địa chỉ kiểu đường dẫn (S3_FORCE_PATH_STYLE); đổi theo kết quả V5."
}

variable "storage_class" {
  type        = string
  description = "Tên StorageClass của đĩa CSDL do nhà cung cấp cấp (mã hóa khi lưu nếu V9 đạt)."
}

variable "storage_class_encrypted" {
  type        = bool
  default     = false
  description = "StorageClass trên có mã hóa khi lưu không (kết quả V9). Phát hành bắt buộc true (FR-011)."
}

variable "drill_egress_cidrs" {
  type        = list(string)
  default     = []
  description = "Chỉ môi trường tạm diễn tập: dải địa chỉ được đi ra (điểm cuối kho tệp, kho ảnh). Rỗng = chặn mọi lưu lượng đi ra ngoài cụm."
}

variable "media_cdn_enabled" {
  type        = bool
  default     = false
  description = "Bật media qua CDN (media.<base_domain>); chờ V3."
}

# ----- Nền tảng Kubernetes -----

variable "mail_capture_enabled" {
  type        = bool
  default     = false
  description = "Bật Mailpit bắt thư (chỉ thử nghiệm)."

  validation {
    condition     = var.environment != "production" || !var.mail_capture_enabled
    error_message = "production: mail_capture_enabled phải là false (FR-029)."
  }
}

variable "search_indexing" {
  type        = bool
  default     = false
  description = "Cho công cụ tìm kiếm lập chỉ mục. Thử nghiệm luôn false."

  validation {
    condition     = var.environment != "staging" || !var.search_indexing
    error_message = "staging: search_indexing phải là false (FR-029)."
  }
}

variable "chart_versions" {
  type        = map(string)
  description = "Phiên bản biểu đồ Helm cố định: ingress, cert_manager, cnpg, barman_cloud."
}

variable "image_versions" {
  type        = map(string)
  description = "Ảnh phụ trợ cố định theo digest: postgres, mailpit."
}

variable "acme_email" {
  type        = string
  description = "Email nhận thông báo chứng chỉ (Let's Encrypt)."
}

variable "monitoring_reserved" {
  type = object({
    cpu        = string
    memory     = string
    storage_gb = number
  })
  description = "Tài nguyên dành cho giám sát (H3); Terraform chỉ giữ chỗ bằng ResourceQuota."
}

variable "registry" {
  type = object({
    server_image = string
    web_image    = string
  })
  description = "Địa chỉ ảnh server và web (kho ảnh dùng chung của hai môi trường, FR-009)."
}
