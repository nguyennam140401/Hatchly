# Kiểm tra tĩnh stack `platform` (T028): provider kubernetes/helm được mock, trạng thái `cloud` được giả bằng
# `override_data`. Chạy: terraform -chdir=infra/stacks/platform test -test-directory=tests
# Phần grep mã nguồn (không `kubernetes_secret`, không provider của nhà cung cấp, không `sensitive`) nằm ở
# tooling/test/infra/provider-module.spec.ts.

mock_provider "kubernetes" {}
mock_provider "helm" {}

variables {
  environment        = "staging"
  project_id         = "p-test"
  name_prefix        = "app"
  region             = "HCM03"
  network_cidr       = "10.20.0.0/16"
  subnet_cidr        = "10.20.1.0/24"
  admin_cidrs        = ["203.0.113.10/32"]
  base_domain        = "staging.example.test"
  cdn_cname_target   = "cdn.example.test"
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
  mail_capture_enabled     = true
  deletion_protection      = false
  chart_versions           = { ingress = "2.8.1", cert_manager = "v1.21.3", cnpg = "0.29.1", barman_cloud = "0.9.0" }
  image_versions = {
    postgres = "ghcr.io/cloudnative-pg/postgresql:17-standard-bookworm@sha256:0639bd0d131295e149a6ab187dd0b3818ec12d6a32c83159b830d5c5bbf29949"
    mailpit  = "docker.io/axllent/mailpit:v1.27@sha256:e22dce5b36f93c77082e204a3942fb6b283b7896e057458400a4c88344c3df68"
  }
  acme_email          = "ops@example.test"
  monitoring_reserved = { cpu = "500m", memory = "1536Mi", storage_gb = 20 }
  registry            = { server_image = "r/server", web_image = "r/web" }
}

override_data {
  target = data.terraform_remote_state.cloud
  values = {
    outputs = {
      cluster = {
        endpoint                = "https://k8s.example.test"
        ca_certificate          = null
        name                    = "app-staging-vks"
        id                      = "cluster-id"
        storage_class           = "sc-test"
        storage_class_encrypted = false
      }
      ingress = {
        public_ip           = "203.0.113.50"
        load_balancer_id    = "lb-1"
        service_annotations = { "vks.vngcloud.vn/load-balancer-id" = "lb-1" }
      }
      object_storage = {
        endpoint         = "https://s3.example.test"
        region           = "HCM03"
        force_path_style = true
        media_bucket     = "app-media-staging"
        backup_bucket    = "app-db-backup-staging"
      }
      database = { variant = "cnpg", managed_host = null, managed_port = null }
      kms      = { key_id = "kms-test" }
      network  = { id = "net-1", subnet_id = "sub-1" }
      labels   = { project = "app", environment = "staging", component = "platform" }
      dns_records = [
        { name = "api.staging.example.test", type = "A", value = "203.0.113.50" },
        { name = "origin-app.staging.example.test", type = "A", value = "203.0.113.50" },
      ]
    }
  }
}

# ---------------------------------------------------------------- không gian tên, chính sách mạng, RBAC

run "khong_gian_ten_du_va_mail_capture_chi_khi_bat" {
  command = apply

  module {
    source = "../../modules/platform-base"
  }

  variables {
    environment          = "staging"
    mail_capture_enabled = true
  }

  assert {
    condition     = alltrue([for n in ["app", "database", "monitoring", "ingress", "cert-manager", "cnpg-system", "mail-capture"] : contains(keys(kubernetes_namespace_v1.this), n)])
    error_message = "Thiếu không gian tên (app, database, monitoring, ingress, cert-manager, cnpg-system, mail-capture)."
  }

  assert {
    condition     = kubernetes_namespace_v1.this["database"].metadata[0].labels["data"] == "true" && alltrue([for k in ["project", "environment", "component"] : contains(keys(kubernetes_namespace_v1.this["app"].metadata[0].labels), k)])
    error_message = "Không gian tên phải có nhãn project/environment/component; `database` thêm data = \"true\"."
  }

  assert {
    condition     = length(kubernetes_deployment_v1.mailpit) == 1 && length(kubernetes_service_v1.mailpit) == 1
    error_message = "Mailpit phải có khi mail_capture_enabled."
  }
}

run "mail_capture_tat_thi_khong_co" {
  command = apply

  module {
    source = "../../modules/platform-base"
  }

  variables {
    environment          = "production"
    mail_capture_enabled = false
  }

  assert {
    condition     = !contains(keys(kubernetes_namespace_v1.this), "mail-capture") && length(kubernetes_deployment_v1.mailpit) == 0
    error_message = "Production: không không gian tên mail-capture, không Mailpit."
  }

  assert {
    condition     = output.mail_capture.smtp_url_hint == null
    error_message = "smtp_url_hint phải null khi tắt."
  }
}

run "network_policy_database_mac_dinh_tu_choi" {
  command = apply

  module {
    source = "../../modules/platform-base"
  }

  assert {
    condition = (
      one(kubernetes_network_policy_v1.database_default_deny.spec).policy_types == tolist(["Ingress"]) &&
      length(one(kubernetes_network_policy_v1.database_default_deny.spec).ingress) == 0
    )
    error_message = "`database` phải mặc định từ chối mọi lưu lượng vào."
  }

  # Chỉ `app` và `monitoring` vào cổng 5432.
  assert {
    condition = (
      length(one(one(kubernetes_network_policy_v1.database_allow_clients.spec).ingress).from) == 2 &&
      toset([for f in one(one(kubernetes_network_policy_v1.database_allow_clients.spec).ingress).from : one(f.namespace_selector).match_labels["kubernetes.io/metadata.name"]]) == toset(["app", "monitoring"]) &&
      one(one(one(kubernetes_network_policy_v1.database_allow_clients.spec).ingress).ports).port == "5432"
    )
    error_message = "Chỉ app và monitoring được vào cổng 5432 của database."
  }
}

run "rbac_moi_service_account_chi_get_mot_secret" {
  command = apply

  module {
    source = "../../modules/platform-base"
  }

  assert {
    condition = alltrue([
      for name, secret in { api = "api-secrets", worker = "worker-secrets", migrate = "migrate-secrets" } :
      (
        one(kubernetes_role_v1.read_own_secret[name].rule).resource_names == toset([secret]) &&
        one(kubernetes_role_v1.read_own_secret[name].rule).verbs == toset(["get"]) &&
        one(kubernetes_role_v1.read_own_secret[name].rule).resources == toset(["secrets"])
      )
    ])
    error_message = "Mỗi ServiceAccount chỉ `get` đúng một Secret (resourceNames)."
  }

  assert {
    condition     = alltrue([for name in ["api", "worker", "migrate"] : one(kubernetes_service_account_v1.this[name].image_pull_secret).name == "registry-pull"])
    error_message = "Ba ServiceAccount phải có imagePullSecrets registry-pull."
  }
}

run "restore_drill_khong_cai_loi_vao" {
  command = apply

  module {
    source = "../../modules/platform-base"
  }

  variables {
    environment      = "drill"
    environment_kind = "restore_drill"
  }

  assert {
    condition     = length(helm_release.ingress) == 0
    error_message = "Môi trường tạm diễn tập không cài lối vào."
  }
}

# ---------------------------------------------------------------- lối vào

run "loi_vao_la_nginx_cua_f5_va_chi_dan_theo_du_lieu_nha_cung_cap" {
  command = apply

  module {
    source = "../../modules/platform-base"
  }

  variables {
    ingress_service_annotations = { "example.test/lb" = "x" }
    search_indexing             = false
  }

  assert {
    condition     = helm_release.ingress[0].chart == "nginx-ingress" && helm_release.ingress[0].repository == "https://helm.nginx.com/stable"
    error_message = "Phải dùng nginx-ingress của F5/NGINX (không dùng kubernetes/ingress-nginx)."
  }

  assert {
    condition = (
      yamldecode(helm_release.ingress[0].values[0]).controller.service.annotations["example.test/lb"] == "x" &&
      yamldecode(helm_release.ingress[0].values[0]).controller.ingressClass.name == "nginx" &&
      strcontains(yamldecode(helm_release.ingress[0].values[0]).controller.config.entries["location-snippets"], "X-Robots-Tag")
    )
    error_message = "Dịch vụ lối vào nhận chú thích nhà cung cấp, lớp nginx, và noindex khi search_indexing = false."
  }
}

# ---------------------------------------------------------------- stack: CSDL, đầu ra

run "csdl_cluster_nhan_tham_so" {
  command = apply

  module {
    source = "../../modules/database-cnpg"
  }

  variables {
    chart_versions  = { cnpg = "0.29.1", barman_cloud = "0.9.0" }
    instances       = 2
    storage_gb      = 20
    storage_class   = "sc-test"
    resources       = { cpu = "1", memory = "2Gi" }
    postgres_image  = "ghcr.io/cloudnative-pg/postgresql:17-standard-bookworm@sha256:0639bd0d131295e149a6ab187dd0b3818ec12d6a32c83159b830d5c5bbf29949"
    max_connections = 220
    archive_timeout = "5min"
    backup_bucket   = "app-db-backup-production"
    s3_endpoint     = "https://s3.example.test"
    s3_region       = "HCM03"
  }

  assert {
    condition = (
      yamldecode(helm_release.pg_cluster.values[0]).instances == 2 &&
      yamldecode(helm_release.pg_cluster.values[0]).maxConnections == "220" &&
      yamldecode(helm_release.pg_cluster.values[0]).archiveTimeout == "5min" &&
      yamldecode(helm_release.pg_cluster.values[0]).mode == "standard"
    )
    error_message = "Cluster CSDL phải nhận instances, max_connections = 220, archive_timeout = 5min."
  }

  assert {
    condition     = helm_release.cnpg_operator.namespace == "cnpg-system" && helm_release.barman_cloud.namespace == "cnpg-system"
    error_message = "Toán tử và trình cắm Barman Cloud nằm trong cnpg-system."
  }

  assert {
    condition     = output.host == "pg-rw.database.svc" && output.backup_secret == "pg-backup-s3" && output.superuser_secret == "pg-superuser"
    error_message = "Đầu ra CSDL theo hợp đồng."
  }
}

run "csdl_chap_nhan_chi_digest" {
  command = plan

  module {
    source = "../../modules/database-cnpg"
  }

  variables {
    chart_versions = { cnpg = "0.29.1", barman_cloud = "0.9.0" }
    instances      = 1
    storage_gb     = 10
    storage_class  = "sc-test"
    resources      = { cpu = "1", memory = "2Gi" }
    postgres_image = "ghcr.io/cloudnative-pg/postgresql:17"
    backup_bucket  = "b"
    s3_endpoint    = "https://s3.example.test"
    s3_region      = "HCM03"
  }

  expect_failures = [var.postgres_image]
}

run "csdl_recovery_thieu_thong_tin_bi_chan" {
  command = plan

  module {
    source = "../../modules/database-cnpg"
  }

  variables {
    chart_versions = { cnpg = "0.29.1", barman_cloud = "0.9.0" }
    instances      = 1
    storage_gb     = 10
    storage_class  = "sc-test"
    resources      = { cpu = "1", memory = "2Gi" }
    postgres_image = "ghcr.io/cloudnative-pg/postgresql:17@sha256:0639bd0d131295e149a6ab187dd0b3818ec12d6a32c83159b830d5c5bbf29949"
    backup_bucket  = "b"
    s3_endpoint    = "https://s3.example.test"
    s3_region      = "HCM03"
    mode           = "recovery"
    recovery       = null
  }

  expect_failures = [var.recovery]
}

run "stack_csdl_nhan_tham_so_va_dau_ra_khong_bi_mat" {
  command = apply

  assert {
    condition     = output.urls.web == "https://app.staging.example.test" && output.urls.api == "https://api.staging.example.test" && output.urls.web_origin_host == "origin-app.staging.example.test"
    error_message = "Địa chỉ giao diện/API/nguồn CDN suy ra từ base_domain."
  }

  assert {
    condition     = output.database.host == "pg-rw.database.svc" && output.database.port == 5432 && output.database.sslmode == "require"
    error_message = "Đầu ra CSDL theo hợp đồng bàn giao."
  }

  assert {
    condition     = contains([for r in output.dns_records : r.type], "CNAME") && length(output.dns_records) == 3
    error_message = "dns_records phải gồm A api, A origin-app và CNAME app → CDN."
  }

  assert {
    condition     = output.secrets.api == "api-secrets" && output.secrets.registry_pull == "registry-pull"
    error_message = "Đầu ra chỉ có TÊN Secret."
  }
}

# ---------------------------------------------------------------- phát hành (US2, T075)

run "production_csdl_hai_ban_giu_sao_luu_30_ngay_chong_cung_may" {
  command = apply

  module {
    source = "../../modules/database-cnpg"
  }

  variables {
    chart_versions      = { cnpg = "0.29.1", barman_cloud = "0.9.0" }
    instances           = 2
    storage_gb          = 20
    storage_class       = "sc-test"
    resources           = { cpu = "1", memory = "2Gi" }
    postgres_image      = "ghcr.io/cloudnative-pg/postgresql:17-standard-bookworm@sha256:0639bd0d131295e149a6ab187dd0b3818ec12d6a32c83159b830d5c5bbf29949"
    backup_bucket       = "app-db-backup-production"
    s3_endpoint         = "https://s3.example.test"
    s3_region           = "HCM03"
    retention_days      = 30
    deletion_protection = true
  }

  assert {
    condition = (
      yamldecode(helm_release.pg_cluster.values[0]).instances == 2 &&
      yamldecode(helm_release.pg_cluster.values[0]).backup.retentionDays == 30 &&
      yamldecode(helm_release.pg_cluster.values[0]).deletionProtect == true
    )
    error_message = "Phát hành: 2 bản, giữ sao lưu 30 ngày, bật bảo vệ xóa."
  }
}

run "staging_csdl_giu_sao_luu_3_ngay" {
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
    backup_bucket  = "app-db-backup-staging"
    s3_endpoint    = "https://s3.example.test"
    s3_region      = "HCM03"
    retention_days = 3
  }

  assert {
    condition     = yamldecode(helm_release.pg_cluster.values[0]).backup.retentionDays == 3
    error_message = "Thử nghiệm: giữ sao lưu 3 ngày."
  }
}

run "production_loi_vao_khong_gan_noindex" {
  command = apply

  module {
    source = "../../modules/platform-base"
  }

  variables {
    environment          = "production"
    mail_capture_enabled = false
    search_indexing      = true
  }

  assert {
    condition     = !contains(keys(yamldecode(helm_release.ingress[0].values[0]).controller.config.entries), "location-snippets")
    error_message = "Phát hành (search_indexing = true): không gắn X-Robots-Tag."
  }

  assert {
    condition     = !contains(keys(kubernetes_namespace_v1.this), "mail-capture")
    error_message = "Phát hành: không có không gian tên mail-capture."
  }
}

run "production_dia_chua_ma_hoa_bi_chan" {
  command = plan

  variables {
    environment = "production"
    # Tham số phát hành hợp lệ khác; chỉ đĩa chưa mã hóa (V9) phải chặn.
    node_groups              = { default = { flavor = "f", count = 2, vcpu = 4, disk_gb = 80 } }
    db_instances             = 2
    db_backup_retention_days = 30
    mail_capture_enabled     = false
    search_indexing          = true
    deletion_protection      = true
  }

  expect_failures = [output.cluster]
}
