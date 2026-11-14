# Phiên bản cố định chính xác (nguyên tắc IX). `required_version` trùng infra/.terraform-version.
terraform {
  required_version = "= 1.11.4"

  required_providers {
    # Nhà cung cấp VNG Cloud: mạng, cụm VKS, nhóm máy, cân bằng tải. Chỉ module provider-vngcloud dùng.
    vngcloud = {
      source  = "vngcloud/vngcloud"
      version = "= 1.3.22"
    }
    # Dùng cho bucket vStorage qua giao diện S3 (vStorage chưa có tài nguyên Terraform riêng).
    aws = {
      source  = "hashicorp/aws"
      version = "= 5.100.0"
    }
  }
}
