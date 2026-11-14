# Bất biến của lớp nhà cung cấp (T027, contracts/provider-layer.md mục 4) – chạy trực tiếp trên module
# `provider-vngcloud` với provider được mock (không cần tài khoản đám mây). Số trong ngoặc là số bất biến.
# Chạy: terraform -chdir=infra/stacks/cloud test -test-directory=tests
# Phần không thể kiểm bằng `terraform test` (đầu ra không `sensitive`, đầu vào không nhận định danh môi trường khác,
# FR-031 chỉ module này dùng `vngcloud_*`/`aws_s3_*`) nằm ở tooling/test/infra/provider-module.spec.ts.

mock_provider "vngcloud" {}

mock_provider "aws" {
  mock_resource "aws_s3_bucket" {
    defaults = {
      arn = "arn:aws:s3:::mock-bucket"
    }
  }
}

variables {
  environment         = "production"
  name_prefix         = "app"
  project_id          = "p-test"
  region              = "HCM03"
  network_cidr        = "10.10.0.0/16"
  subnet_cidr         = "10.10.1.0/24"
  admin_cidrs         = ["203.0.113.10/32"]
  kubernetes_version  = "v1.31.0"
  node_ssh_public_key = "ssh-ed25519 AAAATEST"
  web_origins         = ["https://app.example.test"]
  kms_key_id          = "kms-test"
  lb_package_id       = "lb-pkg-test"

  object_storage_endpoint = "https://s3.example.test"
  storage_class           = "sc-test"

  node_groups = {
    default = { flavor = "f", count = 2, vcpu = 4, disk_gb = 80 }
  }
}

# ---------------------------------------------------------------- (1)(2)(3) kho tệp

run "bucket_rieng_tu_khong_principal_sao" {
  command = apply

  module {
    source = "../../modules/provider-vngcloud"
  }

  # (1) Chặn truy cập công khai ở cả hai bucket.
  assert {
    condition = alltrue([
      for b in [aws_s3_bucket_public_access_block.media[0], aws_s3_bucket_public_access_block.backup[0]] :
      b.block_public_acls && b.block_public_policy && b.ignore_public_acls && b.restrict_public_buckets
    ])
    error_message = "Bucket phải chặn mọi truy cập công khai."
  }

  # (1) Không policy nào có `Principal: *` (kể cả dạng { AWS = "*" }).
  assert {
    condition = alltrue(flatten([
      for p in [aws_s3_bucket_policy.media[0].policy, aws_s3_bucket_policy.backup[0].policy] : [
        for st in jsondecode(p).Statement :
        st.Principal != "*" && !contains(flatten([st.Principal.AWS]), "*")
      ]
    ]))
    error_message = "Bucket policy không được cho Principal: *."
  }

  # (1) Không tài nguyên ACL công khai nào.
  assert {
    condition     = length(aws_s3_bucket_policy.media) == 1 && length(aws_s3_bucket_policy.backup) == 1
    error_message = "Mỗi bucket đúng một policy."
  }
}

run "bucket_media_phien_ban_vong_doi_cors" {
  command = apply

  module {
    source = "../../modules/provider-vngcloud"
  }

  # (2) Bật lưu phiên bản.
  assert {
    condition     = one(aws_s3_bucket_versioning.media[0].versioning_configuration).status == "Enabled"
    error_message = "Bucket media phải bật lưu phiên bản."
  }

  # (2) Đúng ba luật vòng đời: phiên bản cũ 7 ngày, tải dở 7 ngày, nhãn lifecycle=tmp 1 ngày.
  assert {
    condition     = length(aws_s3_bucket_lifecycle_configuration.media[0].rule) == 3
    error_message = "Phải có đúng ba luật vòng đời."
  }

  assert {
    condition = (
      one({ for r in aws_s3_bucket_lifecycle_configuration.media[0].rule : r.id => r }["noncurrent-versions"].noncurrent_version_expiration).noncurrent_days == 7 &&
      one({ for r in aws_s3_bucket_lifecycle_configuration.media[0].rule : r.id => r }["abort-incomplete-multipart"].abort_incomplete_multipart_upload).days_after_initiation == 7 &&
      one({ for r in aws_s3_bucket_lifecycle_configuration.media[0].rule : r.id => r }["expire-tmp"].expiration).days == 1
    )
    error_message = "Ba luật vòng đời phải là 7 / 7 / 1 ngày."
  }

  assert {
    condition = (
      one(one({ for r in aws_s3_bucket_lifecycle_configuration.media[0].rule : r.id => r }["expire-tmp"].filter).tag).key == "lifecycle" &&
      one(one({ for r in aws_s3_bucket_lifecycle_configuration.media[0].rule : r.id => r }["expire-tmp"].filter).tag).value == "tmp"
    )
    error_message = "Luật tệp tạm phải lọc theo nhãn lifecycle=tmp."
  }

  # (2) CORS đúng web_origins, không `*`.
  assert {
    condition = (
      toset(one(aws_s3_bucket_cors_configuration.media[0].cors_rule).allowed_origins) == toset(["https://app.example.test"]) &&
      !contains(one(aws_s3_bucket_cors_configuration.media[0].cors_rule).allowed_origins, "*")
    )
    error_message = "CORS phải đúng web_origins và không chứa *."
  }

  assert {
    condition     = contains(one(aws_s3_bucket_cors_configuration.media[0].cors_rule).expose_headers, "ETag")
    error_message = "CORS phải lộ tiêu đề ETag (tải nhiều phần)."
  }

  # (2) Policy media không có hành động cấu hình bucket.
  assert {
    condition = alltrue([
      for a in flatten([for st in jsondecode(aws_s3_bucket_policy.media[0].policy).Statement : st.Action]) :
      !strcontains(a, "Bucket") && !strcontains(a, "Policy")
    ])
    error_message = "Policy media không được có hành động cấu hình bucket."
  }
}

run "bucket_sao_luu_khong_cors_khong_danh_tinh_ung_dung" {
  command = apply

  module {
    source = "../../modules/provider-vngcloud"
  }

  # (3) Chỉ bucket media có CORS (không có cấu hình CORS nào cho bucket sao lưu).
  assert {
    condition     = length(aws_s3_bucket_cors_configuration.media) == 1
    error_message = "Chỉ bucket media được có CORS."
  }

  # (3) Policy sao lưu không chứa danh tính của ứng dụng.
  assert {
    condition     = !strcontains(aws_s3_bucket_policy.backup[0].policy, "app-production") && strcontains(aws_s3_bucket_policy.backup[0].policy, "dbbackup-production")
    error_message = "Policy bucket sao lưu chỉ cho dbbackup-<env>, không chứa app-<env>."
  }

  # Policy media chỉ cho app-<env>.
  assert {
    condition     = strcontains(aws_s3_bucket_policy.media[0].policy, "app-production") && !strcontains(aws_s3_bucket_policy.media[0].policy, "dbbackup")
    error_message = "Policy bucket media chỉ cho app-<env>."
  }
}

# ---------------------------------------------------------------- (4)(5)(6) vùng, cụm, mạng

run "vung_ngoai_allowed_regions_bi_chan" {
  command = plan

  module {
    source = "../../modules/provider-vngcloud"
  }

  variables {
    region = "sgp01"
  }

  expect_failures = [var.region]
}

run "cum_gioi_han_dia_chi_goi_api" {
  command = apply

  module {
    source = "../../modules/provider-vngcloud"
  }

  # (5) Danh sách được phép chứa admin_cidrs (+ chính mạng con của máy), khác rỗng, không /0.
  assert {
    condition = (
      length(vngcloud_vks_cluster.this.white_list_node_cidr) > 0 &&
      alltrue([for c in var.admin_cidrs : contains(vngcloud_vks_cluster.this.white_list_node_cidr, c)]) &&
      alltrue([for c in vngcloud_vks_cluster.this.white_list_node_cidr : !endswith(c, "/0")])
    )
    error_message = "Cụm phải giới hạn địa chỉ gọi API bằng admin_cidrs, không /0."
  }

  assert {
    condition     = vngcloud_vks_cluster.this.enabled_load_balancer_plugin && vngcloud_vks_cluster.this.enabled_block_store_csi_plugin && vngcloud_vks_cluster.this.network_type == "CALICO"
    error_message = "Cụm phải bật trình cắm cân bằng tải, CSI đĩa và mạng CALICO (NetworkPolicy)."
  }
}

run "admin_cidrs_mo_ra_internet_bi_chan" {
  command = plan

  module {
    source = "../../modules/provider-vngcloud"
  }

  variables {
    admin_cidrs = ["0.0.0.0/0"]
  }

  expect_failures = [var.admin_cidrs]
}

run "nhom_bao_mat_khong_mo_22_5432_ra_internet" {
  command = apply

  module {
    source = "../../modules/provider-vngcloud"
  }

  # (6) Không luật VÀO nào từ 0.0.0.0/0.
  assert {
    condition     = alltrue([for r in vngcloud_vserver_secgrouprule.ingress : r.remote_ip_prefix != "0.0.0.0/0" && r.direction == "ingress"])
    error_message = "Không luật nhóm bảo mật nào được mở cổng vào từ 0.0.0.0/0."
  }

  # (6) Không luật nào chỉ định riêng cổng 22 hoặc 5432.
  assert {
    condition = alltrue([
      for r in concat(values(vngcloud_vserver_secgrouprule.ingress), values(vngcloud_vserver_secgrouprule.egress)) :
      !(r.port_range_min == r.port_range_max && contains([22, 5432], r.port_range_min))
    ])
    error_message = "Không mở riêng cổng 22 hoặc 5432."
  }
}

# ---------------------------------------------------------------- (7) production

run "production_tat_may_bi_chan" {
  command = plan

  module {
    source = "../../modules/provider-vngcloud"
  }

  variables {
    powered = false
  }

  expect_failures = [var.powered]
}

run "production_mot_may_bi_chan" {
  command = plan

  module {
    source = "../../modules/provider-vngcloud"
  }

  variables {
    node_groups = { default = { flavor = "f", count = 1, vcpu = 4, disk_gb = 80 } }
  }

  expect_failures = [var.node_groups]
}

run "production_bao_ve_xoa_mac_dinh_bat" {
  command = apply

  module {
    source = "../../modules/provider-vngcloud"
  }

  assert {
    condition     = !aws_s3_bucket.media[0].force_destroy && !aws_s3_bucket.backup[0].force_destroy
    error_message = "Production: bảo vệ xóa mặc định bật (force_destroy = false)."
  }
}

run "production_ghi_de_bao_ve_xoa_tuong_minh" {
  command = apply

  module {
    source = "../../modules/provider-vngcloud"
  }

  variables {
    deletion_protection = false
  }

  assert {
    condition     = aws_s3_bucket.media[0].force_destroy
    error_message = "Đặt deletion_protection = false tường minh thì được ghi đè."
  }
}

run "staging_bao_ve_xoa_mac_dinh_tat" {
  command = apply

  module {
    source = "../../modules/provider-vngcloud"
  }

  variables {
    environment = "staging"
    node_groups = { default = { flavor = "f", count = 1, vcpu = 4, disk_gb = 50 } }
  }

  assert {
    condition     = aws_s3_bucket.media[0].force_destroy
    error_message = "Thử nghiệm: không đặt thì không bảo vệ xóa."
  }
}

# ---------------------------------------------------------------- tắt/bật máy (FR-034)

run "tat_may_giu_cum_lb_bucket" {
  command = apply

  module {
    source = "../../modules/provider-vngcloud"
  }

  variables {
    environment = "staging"
    node_groups = { default = { flavor = "f", count = 1, vcpu = 4, disk_gb = 50 } }
    powered     = false
  }

  assert {
    condition     = length(vngcloud_vks_cluster_node_group.this) == 0
    error_message = "powered = false: mọi nhóm máy về 0."
  }

  assert {
    condition     = vngcloud_vks_cluster.this.id != "" && length(vngcloud_vlb_load_balancer.ingress) == 1 && length(aws_s3_bucket.media) == 1
    error_message = "Cụm, cân bằng tải, bucket phải còn khi tắt máy."
  }
}

# ---------------------------------------------------------------- (8) môi trường tạm diễn tập

run "restore_drill_khong_lb_khong_bucket_chan_di_ra" {
  command = apply

  module {
    source = "../../modules/provider-vngcloud"
  }

  variables {
    environment          = "drill"
    environment_kind     = "restore_drill"
    source_backup_bucket = "app-db-backup-production"
    node_groups          = { default = { flavor = "f", count = 1, vcpu = 4, disk_gb = 50 } }
  }

  assert {
    condition     = length(vngcloud_vlb_load_balancer.ingress) == 0
    error_message = "restore_drill: không cân bằng tải."
  }

  assert {
    condition     = length(aws_s3_bucket.media) == 0 && length(aws_s3_bucket.backup) == 0
    error_message = "restore_drill: không tạo bucket mới."
  }

  # Không cho đi ra đâu (drill_egress_cidrs rỗng) – chặn mọi lưu lượng đi ra.
  assert {
    condition     = length(vngcloud_vserver_secgrouprule.egress) == 0
    error_message = "restore_drill: chặn đi ra trừ kho tệp và kho ảnh."
  }

  # Ngoại lệ bất biến 10: nhận TÊN bucket sao lưu của nguồn, chỉ để đọc.
  assert {
    condition     = output.object_storage.backup_bucket == "app-db-backup-production" && output.object_storage.media_bucket == null
    error_message = "restore_drill: backup_bucket là bucket của môi trường nguồn."
  }
}

run "restore_drill_chi_ra_toi_dia_chi_cho_phep" {
  command = apply

  module {
    source = "../../modules/provider-vngcloud"
  }

  variables {
    environment        = "drill"
    environment_kind   = "restore_drill"
    drill_egress_cidrs = ["198.51.100.0/24"]
    node_groups        = { default = { flavor = "f", count = 1, vcpu = 4, disk_gb = 50 } }
  }

  assert {
    condition     = alltrue([for r in vngcloud_vserver_secgrouprule.egress : r.remote_ip_prefix == "198.51.100.0/24"]) && length(vngcloud_vserver_secgrouprule.egress) == 2
    error_message = "restore_drill chỉ được đi ra tới dải đã khai."
  }
}

# ---------------------------------------------------------------- đầu ra theo hợp đồng (mục 3)

run "dau_ra_du_khoa_dung_ten" {
  command = apply

  module {
    source = "../../modules/provider-vngcloud"
  }

  assert {
    condition = alltrue([
      contains(keys(output.cluster), "endpoint"), contains(keys(output.cluster), "ca_certificate"),
      contains(keys(output.cluster), "name"), contains(keys(output.cluster), "id"),
      contains(keys(output.cluster), "storage_class"), contains(keys(output.cluster), "storage_class_encrypted"),
      contains(keys(output.ingress), "public_ip"), contains(keys(output.ingress), "load_balancer_id"),
      contains(keys(output.ingress), "service_annotations"),
      contains(keys(output.object_storage), "endpoint"), contains(keys(output.object_storage), "region"),
      contains(keys(output.object_storage), "force_path_style"), contains(keys(output.object_storage), "media_bucket"),
      contains(keys(output.object_storage), "backup_bucket"),
      contains(keys(output.database), "variant"), contains(keys(output.database), "managed_host"),
      contains(keys(output.database), "managed_port"),
      contains(keys(output.kms), "key_id"),
      contains(keys(output.network), "id"), contains(keys(output.network), "subnet_id"),
    ])
    error_message = "Đầu ra của module phải đủ khóa theo contracts/provider-layer.md mục 3."
  }

  assert {
    condition     = output.ingress.service_annotations["vks.vngcloud.vn/load-balancer-id"] == output.ingress.load_balancer_id
    error_message = "Chú thích dịch vụ lối vào phải trỏ tới cân bằng tải tạo sẵn (V8)."
  }

  assert {
    condition     = output.object_storage.media_bucket == "app-media-production" && output.object_storage.backup_bucket == "app-db-backup-production"
    error_message = "Tên bucket theo <prefix>-<loại>-<env>."
  }

  assert {
    condition     = output.cluster.storage_class == "sc-test" && !output.cluster.storage_class_encrypted
    error_message = "Lớp lưu trữ phải chuyển ra đầu ra."
  }
}

# ---------------------------------------------------------------- khác

run "web_origins_cam_ky_tu_dai_dien" {
  command = plan

  module {
    source = "../../modules/provider-vngcloud"
  }

  variables {
    web_origins = ["*"]
  }

  expect_failures = [var.web_origins]
}

run "kms_key_id_rong_bi_chan" {
  command = plan

  module {
    source = "../../modules/provider-vngcloud"
  }

  variables {
    kms_key_id = "  "
  }

  expect_failures = [var.kms_key_id]
}

run "managed_chua_hien_thuc" {
  command = plan

  module {
    source = "../../modules/provider-vngcloud"
  }

  variables {
    db_variant = "managed"
    managed_db = { host = "db.example.test" }
  }

  expect_failures = [terraform_data.managed_db_not_implemented]
}

# ---------------------------------------------------------------- SC-013: nhà cung cấp thay được

# Module giả (chỉ terraform_data) có ĐỦ khóa đầu ra của hợp đồng: stack platform chỉ cần bấy nhiêu, không sửa dòng nào.
run "module_gia_dat_hop_dong_dau_ra" {
  command = apply

  module {
    source = "./tests/fixtures/provider-stub"
  }

  variables {
    environment = "staging"
    name_prefix = "app"
    kms_key_id  = "kms-test"
  }

  assert {
    condition = (
      toset(keys(output.cluster)) == toset(["endpoint", "ca_certificate", "name", "id", "storage_class", "storage_class_encrypted"]) &&
      toset(keys(output.ingress)) == toset(["public_ip", "load_balancer_id", "service_annotations"]) &&
      toset(keys(output.object_storage)) == toset(["endpoint", "region", "force_path_style", "media_bucket", "backup_bucket"]) &&
      toset(keys(output.database)) == toset(["variant", "managed_host", "managed_port"]) &&
      toset(keys(output.kms)) == toset(["key_id"]) &&
      toset(keys(output.network)) == toset(["id", "subnet_id"])
    )
    error_message = "Module giả phải có đúng khóa đầu ra của hợp đồng lớp nhà cung cấp."
  }
}
