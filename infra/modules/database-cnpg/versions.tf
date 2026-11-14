# Module CSDL PostgreSQL bằng CloudNativePG + trình cắm Barman Cloud (T045, research R6). Chuẩn mở: PostgreSQL,
# Kubernetes, giao diện S3. Không có tài nguyên của nhà cung cấp.
terraform {
  required_version = "= 1.11.4"

  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "= 2.17.0"
    }
  }
}
