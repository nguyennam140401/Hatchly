# Cụm PostgreSQL `pg` trong `database` (T046–T047): biểu đồ Helm cục bộ `charts/pg-cluster` (Cluster, ObjectStore,
# ScheduledBackup) để không phụ thuộc `kubernetes_manifest` (cần CRD ngay lúc lập kế hoạch).
# Dịch vụ ổn định `pg-rw.database.svc` do toán tử tạo. Terraform KHÔNG tạo giá trị bí mật: `pg-superuser` do toán
# tử sinh, `pg-backup-s3` do `pnpm infra secrets set` nhập (chỉ tham chiếu theo TÊN).

resource "helm_release" "pg_cluster" {
  name      = "pg-cluster"
  namespace = "database"
  chart     = "${path.module}/charts/pg-cluster"

  wait    = true
  timeout = 900

  values = [yamlencode({
    name             = "pg"
    mode             = var.mode
    instances        = var.instances
    image            = var.postgres_image
    storageSize      = "${var.storage_gb}Gi"
    storageClass     = var.storage_class
    resources        = { cpu = var.resources.cpu, memory = var.resources.memory }
    maxConnections   = tostring(var.max_connections)
    archiveTimeout   = var.archive_timeout
    deletionProtect  = var.deletion_protection
    labels           = var.labels
    backupSecretName = "pg-backup-s3"

    backup = {
      bucket        = var.backup_bucket
      endpoint      = var.s3_endpoint
      region        = var.s3_region
      retentionDays = var.retention_days
      # 02:00 UTC+7 = 19:00 UTC (giờ thấp điểm). Cron của CloudNativePG có thêm trường giây ở đầu.
      schedule = "0 0 19 * * *"
    }

    recovery = var.recovery == null ? {} : {
      targetTime = var.recovery.target_time
      serverName = var.recovery.server_name
    }
  })]

  depends_on = [helm_release.barman_cloud]
}
