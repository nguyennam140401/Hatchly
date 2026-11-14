# Mailpit bắt thư (T043) – CHỈ thử nghiệm (`mail_capture_enabled`). SMTP cổng 1025 chỉ nhận từ `app`; giao diện 8025
# KHÔNG có Ingress (xem bằng `kubectl port-forward -n mail-capture svc/mailpit 8025:8025`).

resource "kubernetes_deployment_v1" "mailpit" {
  count = var.mail_capture_enabled ? 1 : 0

  metadata {
    name      = "mailpit"
    namespace = kubernetes_namespace_v1.this["mail-capture"].metadata[0].name
    labels    = merge(local.base_labels, { component = "mail-capture" })
  }

  spec {
    replicas = 1

    selector {
      match_labels = { app = "mailpit" }
    }

    template {
      metadata {
        labels = { app = "mailpit" }
      }

      spec {
        container {
          name  = "mailpit"
          image = var.image_versions["mailpit"]

          port {
            name           = "smtp"
            container_port = 1025
          }

          port {
            name           = "http"
            container_port = 8025
          }

          resources {
            requests = {
              cpu    = "20m"
              memory = "64Mi"
            }
            limits = {
              cpu    = "200m"
              memory = "256Mi"
            }
          }

          security_context {
            run_as_non_root            = true
            run_as_user                = 1000
            allow_privilege_escalation = false
          }
        }
      }
    }
  }
}

resource "kubernetes_service_v1" "mailpit" {
  count = var.mail_capture_enabled ? 1 : 0

  metadata {
    name      = "mailpit"
    namespace = kubernetes_namespace_v1.this["mail-capture"].metadata[0].name
    labels    = merge(local.base_labels, { component = "mail-capture" })
  }

  spec {
    selector = { app = "mailpit" }

    port {
      name        = "smtp"
      port        = 1025
      target_port = "smtp"
    }

    port {
      name        = "http"
      port        = 8025
      target_port = "http"
    }
  }
}

resource "kubernetes_network_policy_v1" "mail_capture_smtp_from_app" {
  count = var.mail_capture_enabled ? 1 : 0

  metadata {
    name      = "smtp-from-app-only"
    namespace = kubernetes_namespace_v1.this["mail-capture"].metadata[0].name
  }

  spec {
    pod_selector {}
    policy_types = ["Ingress"]

    ingress {
      ports {
        port     = "1025"
        protocol = "TCP"
      }

      from {
        namespace_selector {
          match_labels = local.ns_selector["app"]
        }
      }
    }
  }
}
