# Module GIẢ của lớp nhà cung cấp (T112, SC-013): đúng đầu vào/đầu ra của contracts/provider-layer.md, chỉ dùng
# `terraform_data`. Chứng minh stack `platform` và kê khai chỉ phụ thuộc HỢP ĐỒNG: thay module nhà cung cấp bằng module
# này thì đầu ra vẫn đủ khóa và `stacks/platform` không phải sửa dòng nào.
terraform {
  required_version = "= 1.11.4"
}

variable "environment" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "kms_key_id" {
  type = string
}

variable "object_storage_endpoint" {
  type    = string
  default = "https://stub.example.test"
}

variable "region" {
  type    = string
  default = "stub-1"
}

resource "terraform_data" "stub" {
  input = "${var.name_prefix}-${var.environment}"
}

output "cluster" {
  value = {
    endpoint                = "https://stub-cluster.example.test"
    ca_certificate          = null
    name                    = "${terraform_data.stub.input}-stub"
    id                      = "stub-cluster"
    storage_class           = "stub-class"
    storage_class_encrypted = true
  }
}

output "ingress" {
  value = {
    public_ip           = "203.0.113.99"
    load_balancer_id    = null
    service_annotations = {}
  }
}

output "object_storage" {
  value = {
    endpoint         = var.object_storage_endpoint
    region           = var.region
    force_path_style = true
    media_bucket     = "${terraform_data.stub.input}-media"
    backup_bucket    = "${terraform_data.stub.input}-backup"
  }
}

output "database" {
  value = {
    variant      = "cnpg"
    managed_host = null
    managed_port = null
  }
}

output "kms" {
  value = { key_id = var.kms_key_id }
}

output "network" {
  value = { id = "stub-net", subnet_id = "stub-subnet" }
}

output "labels" {
  value = { project = var.name_prefix, environment = var.environment, component = "platform" }
}
