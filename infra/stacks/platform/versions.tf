# Phiên bản cố định chính xác (nguyên tắc IX). `required_version` trùng infra/.terraform-version.
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
