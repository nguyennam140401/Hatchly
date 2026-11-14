# Module lớp nhà cung cấp VNG Cloud (contracts/provider-layer.md). Nơi DUY NHẤT được dùng `vngcloud_*` và
# `aws_s3_*` (FR-031). Cấu hình provider (chứng thực, điểm cuối) nằm ở stack gọi module, không ở đây.
terraform {
  required_version = "= 1.11.4"

  required_providers {
    vngcloud = {
      source  = "vngcloud/vngcloud"
      version = "= 1.3.22"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "= 5.100.0"
    }
  }
}
