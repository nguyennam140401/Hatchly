# Đầu ra (T044). Chỉ TÊN Secret/khóa – không giá trị bí mật nào; không `sensitive`.

output "namespaces" {
  description = "Tên các không gian tên chính."
  value = {
    app        = kubernetes_namespace_v1.this["app"].metadata[0].name
    database   = kubernetes_namespace_v1.this["database"].metadata[0].name
    monitoring = kubernetes_namespace_v1.this["monitoring"].metadata[0].name
  }
}

output "ingress" {
  description = "Lớp lối vào và ClusterIssuer cho kê khai của H2."
  value = {
    class          = "nginx"
    cluster_issuer = "letsencrypt"
  }
}

output "secrets" {
  description = "Tên Secret (H2 tham chiếu; giá trị do `pnpm infra secrets` tạo)."
  value = {
    api           = local.service_accounts.api
    worker        = local.service_accounts.worker
    migrate       = local.service_accounts.migrate
    registry_pull = local.registry_pull_secret
  }
}

output "service_accounts" {
  description = "Tên ServiceAccount."
  value       = { for name, _ in local.active_service_accounts : name => kubernetes_service_account_v1.this[name].metadata[0].name }
}

output "monitoring" {
  description = "Chỗ dành cho giám sát (H3)."
  value = {
    reserved = var.monitoring_reserved
  }
}

output "mail_capture" {
  description = "Gợi ý SMTP của Mailpit; null khi tắt."
  value = {
    smtp_url_hint = var.mail_capture_enabled ? "smtp://mailpit.mail-capture.svc:1025" : null
  }
}
