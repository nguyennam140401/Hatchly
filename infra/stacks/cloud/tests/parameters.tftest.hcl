# Kiểm tra các quy tắc `validation` của variables.shared.tf (T017, contracts/environment-parameters.md mục 3).
# Chạy: terraform -chdir=infra/stacks/cloud test -test-directory=../../tests/cloud
# Tự đủ biến (không phụ thuộc -var-file): `variables` cấp tệp thắng biến dòng lệnh; mỗi `run` chỉ ghi đè phần cần thử.
# Việc nạp nguyên envs/*.tfvars nằm ở infra/tests/cloud/env-load/ (CLI truyền -var-file từng môi trường).

mock_provider "vngcloud" {}
mock_provider "aws" {}

variables {
  vngcloud_client_id     = "mock-id"
  vngcloud_client_secret = "mock-value"
  environment            = "production"
  environment_kind       = "standard"
  project_id             = "p-test"
  name_prefix            = "app"
  region                 = "HCM03"
  network_cidr           = "10.10.0.0/16"
  subnet_cidr            = "10.10.1.0/24"
  admin_cidrs            = ["203.0.113.10/32"]
  base_domain            = "example.test"
  kubernetes_version     = "v1.31.0"
  node_groups = {
    default = { flavor = "f", count = 2, vcpu = 4, disk_gb = 80, zones = [] }
  }
  db_instances             = 2
  db_backup_retention_days = 30
  kms_key_id               = "kms-test"
  node_ssh_public_key      = "ssh-ed25519 AAAATEST"
  lb_package_id            = "lb-pkg-test"
  object_storage_endpoint  = "https://s3.example.test"
  storage_class            = "sc-test"
  chart_versions           = {}
  image_versions           = {}
  acme_email               = "ops@example.test"
  monitoring_reserved      = { cpu = "500m", memory = "1Gi", storage_gb = 10 }
  registry                 = { server_image = "r/server", web_image = "r/web" }
}

# ---------- Các tổ hợp hợp lệ ----------

run "production_hop_le" {
  command = plan
}

run "staging_hop_le" {
  command = plan
  variables {
    environment              = "staging"
    node_groups              = { default = { flavor = "f", count = 1, vcpu = 4, disk_gb = 50, zones = [] } }
    db_instances             = 1
    db_backup_retention_days = 3
    mail_capture_enabled     = true
  }
}

run "drill_hop_le" {
  command = plan
  variables {
    environment      = "drill"
    environment_kind = "restore_drill"
  }
}

# ---------- Quy tắc chung ----------

run "vung_ngoai_allowed_regions" {
  command = plan
  variables {
    region = "sgp01"
  }
  expect_failures = [var.region]
}

run "admin_cidrs_mo_ra_internet" {
  command = plan
  variables {
    admin_cidrs = ["0.0.0.0/0"]
  }
  expect_failures = [var.admin_cidrs]
}

run "admin_cidrs_rong" {
  command = plan
  variables {
    admin_cidrs = []
  }
  expect_failures = [var.admin_cidrs]
}

run "drill_nhung_kind_standard" {
  command = plan
  variables {
    environment      = "drill"
    environment_kind = "standard"
  }
  expect_failures = [var.environment_kind]
}

run "db_managed_thieu_managed_db" {
  command = plan
  variables {
    db_variant = "managed"
    managed_db = null
  }
  expect_failures = [var.managed_db]
}

# ---------- production ----------

run "production_powered_false" {
  command = plan
  variables {
    powered = false
  }
  expect_failures = [var.powered]
}

run "production_bat_mail_capture" {
  command = plan
  variables {
    mail_capture_enabled = true
  }
  expect_failures = [var.mail_capture_enabled]
}

run "production_chi_mot_may" {
  command = plan
  variables {
    node_groups = { default = { flavor = "f", count = 1, vcpu = 4, disk_gb = 80, zones = [] } }
  }
  expect_failures = [var.node_groups]
}

run "production_mot_ban_csdl" {
  command = plan
  variables {
    db_instances = 1
  }
  expect_failures = [var.db_instances]
}

run "production_giu_sao_luu_29_ngay" {
  command = plan
  variables {
    db_backup_retention_days = 29
  }
  expect_failures = [var.db_backup_retention_days]
}

# ---------- staging ----------

run "staging_bat_search_indexing" {
  command = plan
  variables {
    environment              = "staging"
    node_groups              = { default = { flavor = "f", count = 1, vcpu = 4, disk_gb = 50, zones = [] } }
    db_instances             = 1
    db_backup_retention_days = 3
    search_indexing          = true
  }
  expect_failures = [var.search_indexing]
}

run "staging_giu_sao_luu_2_ngay" {
  command = plan
  variables {
    environment              = "staging"
    node_groups              = { default = { flavor = "f", count = 1, vcpu = 4, disk_gb = 50, zones = [] } }
    db_instances             = 1
    db_backup_retention_days = 2
  }
  expect_failures = [var.db_backup_retention_days]
}

run "staging_vuot_staging_max_vcpu" {
  command = plan
  variables {
    environment              = "staging"
    node_groups              = { default = { flavor = "f", count = 3, vcpu = 4, disk_gb = 50, zones = [] } }
    db_instances             = 1
    db_backup_retention_days = 3
  }
  expect_failures = [var.node_groups]
}
