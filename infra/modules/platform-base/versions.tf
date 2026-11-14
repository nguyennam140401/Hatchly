# Module nền tảng Kubernetes dùng chuẩn mở (T038): không gian tên, hạn mức, chính sách mạng, lối vào, chứng chỉ, RBAC.
# KHÔNG có tài nguyên của nhà cung cấp (`vngcloud_*`, `aws_*`) – đổi nhà cung cấp không đụng module này (FR-031).
terraform {
  required_version = "= 1.11.4"

  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "= 2.38.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "= 2.17.0"
    }
  }
}
