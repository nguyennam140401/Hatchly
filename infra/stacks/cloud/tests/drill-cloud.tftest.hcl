# Môi trường tạm diễn tập – stack cloud (T102, bất biến 8 của contracts/provider-layer.md, research R14).
# Chạy: terraform -chdir=infra/stacks/cloud test -test-directory=tests

mock_provider "vngcloud" {}
mock_provider "aws" {}

variables {
  vngcloud_client_id     = "mock-id"
  vngcloud_client_secret = "mock-value"

  environment        = "drill"
  environment_kind   = "restore_drill"
  project_id         = "p-prod"
  name_prefix        = "app"
  region             = "HCM03"
  network_cidr       = "10.30.0.0/16"
  subnet_cidr        = "10.30.1.0/24"
  admin_cidrs        = ["203.0.113.10/32"]
  base_domain        = "drill.example.test"
  kubernetes_version = "v1.31.0"
  node_groups = {
    default = { flavor = "f", count = 1, vcpu = 4, disk_gb = 50 }
  }
  node_ssh_public_key      = "ssh-ed25519 AAAATEST"
  lb_package_id            = "lb-pkg-test"
  object_storage_endpoint  = "https://s3.example.test"
  storage_class            = "sc-test"
  db_instances             = 1
  db_backup_retention_days = 3
  kms_key_id               = "kms-test"
  deletion_protection      = false
  chart_versions           = {}
  image_versions           = {}
  acme_email               = "ops@example.test"
  monitoring_reserved      = { cpu = "500m", memory = "1Gi", storage_gb = 10 }
  registry                 = { server_image = "r/server", web_image = "r/web" }

  drill_source_backup_bucket = "app-db-backup-production"
}

run "drill_khong_lb_khong_ip_khong_bucket_moi" {
  command = apply

  assert {
    condition     = output.ingress.public_ip == null && output.ingress.load_balancer_id == null
    error_message = "Môi trường tạm: không cân bằng tải, không địa chỉ công khai."
  }

  assert {
    condition     = output.object_storage.media_bucket == null && output.object_storage.backup_bucket == "app-db-backup-production"
    error_message = "Không bucket mới; chỉ nhận TÊN bucket sao lưu của nguồn (chỉ đọc)."
  }
}

run "drill_chan_di_ra_mac_dinh_va_dung_mot_may" {
  command = apply

  module {
    source = "../../modules/provider-vngcloud"
  }

  variables {
    environment         = "drill"
    environment_kind    = "restore_drill"
    web_origins         = ["https://app.drill.example.test"]
    node_ssh_public_key = "ssh-ed25519 AAAATEST"
  }

  assert {
    condition     = length(vngcloud_vserver_secgrouprule.egress) == 0
    error_message = "Mặc định chặn mọi lưu lượng đi ra."
  }

  assert {
    condition     = length(vngcloud_vks_cluster_node_group.this) == 1 && one(values(vngcloud_vks_cluster_node_group.this)).num_nodes == 1
    error_message = "Môi trường tạm đúng 1 máy."
  }
}

run "drill_chi_ra_toi_kho_tep_va_kho_anh" {
  command = apply

  module {
    source = "../../modules/provider-vngcloud"
  }

  variables {
    environment        = "drill"
    environment_kind   = "restore_drill"
    web_origins        = ["https://app.drill.example.test"]
    drill_egress_cidrs = ["198.51.100.0/24", "192.0.2.0/24"]
  }

  assert {
    condition     = toset([for r in vngcloud_vserver_secgrouprule.egress : r.remote_ip_prefix]) == toset(["198.51.100.0/24", "192.0.2.0/24"])
    error_message = "Chỉ được đi ra tới các dải đã khai."
  }
}

run "drill_cidr_khac_moi_truong_nguon" {
  command = plan

  assert {
    condition     = var.network_cidr != "10.10.0.0/16" && var.network_cidr != "10.20.0.0/16"
    error_message = "CIDR của môi trường tạm không được trùng production/staging."
  }
}
