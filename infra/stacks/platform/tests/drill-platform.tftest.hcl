# Môi trường tạm diễn tập – stack platform (T102, research R14).
# Chạy: terraform -chdir=infra/stacks/platform test -test-directory=tests

mock_provider "kubernetes" {}
mock_provider "helm" {}

variables {
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
  db_storage_gb            = 10
  db_backup_retention_days = 3
  kms_key_id               = "kms-test"
  deletion_protection      = false
  chart_versions           = { ingress = "2.8.1", cert_manager = "v1.21.3", cnpg = "0.29.1", barman_cloud = "0.9.0" }
  image_versions = {
    postgres = "ghcr.io/cloudnative-pg/postgresql:17-standard-bookworm@sha256:0639bd0d131295e149a6ab187dd0b3818ec12d6a32c83159b830d5c5bbf29949"
    mailpit  = "docker.io/axllent/mailpit:v1.27@sha256:e22dce5b36f93c77082e204a3942fb6b283b7896e057458400a4c88344c3df68"
  }
  acme_email          = "ops@example.test"
  monitoring_reserved = { cpu = "500m", memory = "1Gi", storage_gb = 10 }
  registry            = { server_image = "r/server", web_image = "r/web" }
  drill_target_time   = "2026-12-01T02:00:00Z"
}

override_data {
  target = data.terraform_remote_state.cloud
  values = {
    outputs = {
      cluster = {
        endpoint                = "https://k8s.example.test"
        ca_certificate          = null
        name                    = "app-drill-vks"
        id                      = "c1"
        storage_class           = "sc-test"
        storage_class_encrypted = true
      }
      ingress        = { public_ip = null, load_balancer_id = null, service_annotations = {} }
      object_storage = { endpoint = "https://s3.example.test", region = "HCM03", force_path_style = true, media_bucket = null, backup_bucket = "app-db-backup-production" }
      database       = { variant = "cnpg", managed_host = null, managed_port = null }
      kms            = { key_id = "kms-test" }
      network        = { id = "n", subnet_id = "s" }
      labels         = {}
      dns_records    = []
    }
  }
}

run "drill_khong_loi_vao_issuer_mailpit_api_worker_va_chan_di_ra" {
  command = apply

  module {
    source = "../../modules/platform-base"
  }

  variables {
    environment          = "drill"
    environment_kind     = "restore_drill"
    mail_capture_enabled = false
    egress_allowed_cidrs = ["10.30.1.0/24", "198.51.100.0/24"]
  }

  assert {
    condition     = length(helm_release.ingress) == 0 && length(helm_release.cluster_issuer) == 0
    error_message = "Không lối vào, không ClusterIssuer."
  }

  assert {
    condition     = length(kubernetes_deployment_v1.mailpit) == 0 && !contains(keys(kubernetes_service_account_v1.this), "api") && !contains(keys(kubernetes_service_account_v1.this), "worker")
    error_message = "Không Mailpit, không ServiceAccount api/worker."
  }

  assert {
    condition     = length(kubernetes_network_policy_v1.drill_default_deny_egress) == 6
    error_message = "Mọi không gian tên phải có chính sách chặn đi ra."
  }

  # Chỉ DNS, nội bộ cụm và hai dải khai báo; không đường ra internet nói chung (không SMTP, HTTP(S)).
  assert {
    condition = alltrue([
      for p in values(kubernetes_network_policy_v1.drill_default_deny_egress) :
      one(p.spec).policy_types == tolist(["Egress"]) && length(one(p.spec).egress) == 4
    ])
    error_message = "Egress chỉ gồm DNS, nội bộ cụm và 2 dải khai báo."
  }
}

run "drill_cluster_recovery_voi_target_time_khong_sao_luu_rieng" {
  command = apply

  module {
    source = "../../modules/database-cnpg"
  }

  variables {
    chart_versions = { cnpg = "0.29.1", barman_cloud = "0.9.0" }
    instances      = 1
    storage_gb     = 10
    storage_class  = "sc-test"
    resources      = { cpu = "500m", memory = "1Gi" }
    postgres_image = "ghcr.io/cloudnative-pg/postgresql:17-standard-bookworm@sha256:0639bd0d131295e149a6ab187dd0b3818ec12d6a32c83159b830d5c5bbf29949"
    backup_bucket  = "app-db-backup-production"
    s3_endpoint    = "https://s3.example.test"
    s3_region      = "HCM03"
    mode           = "recovery"
    recovery       = { target_time = "2026-12-01T02:00:00Z" }
  }

  assert {
    condition = (
      yamldecode(helm_release.pg_cluster.values[0]).mode == "recovery" &&
      yamldecode(helm_release.pg_cluster.values[0]).recovery.targetTime == "2026-12-01T02:00:00Z" &&
      yamldecode(helm_release.pg_cluster.values[0]).recovery.serverName == "pg"
    )
    error_message = "Chế độ recovery phải mang targetTime và serverName nguồn."
  }
}
