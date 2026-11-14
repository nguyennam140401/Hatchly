# Chính sách mạng (T039; mạng CALICO của VKS có NetworkPolicy). Mặc định từ chối vào `database`;
# chỉ `app` và `monitoring` được vào cổng 5432.

locals {
  ns_selector = { for name in keys(local.namespaces) : name => { "kubernetes.io/metadata.name" = name } }
}

resource "kubernetes_network_policy_v1" "database_default_deny" {
  metadata {
    name      = "default-deny-ingress"
    namespace = kubernetes_namespace_v1.this["database"].metadata[0].name
  }

  spec {
    pod_selector {}
    policy_types = ["Ingress"]
  }
}

resource "kubernetes_network_policy_v1" "database_allow_clients" {
  metadata {
    name      = "allow-postgres-from-app-monitoring"
    namespace = kubernetes_namespace_v1.this["database"].metadata[0].name
  }

  spec {
    pod_selector {}
    policy_types = ["Ingress"]

    ingress {
      ports {
        port     = "5432"
        protocol = "TCP"
      }

      from {
        namespace_selector {
          match_labels = local.ns_selector["app"]
        }
      }

      from {
        namespace_selector {
          match_labels = local.ns_selector["monitoring"]
        }
      }
    }
  }
}

# Nội bộ `database` (sao chép giữa các bản) và toán tử CloudNativePG (quản lý, kiểm tra trạng thái).
resource "kubernetes_network_policy_v1" "database_allow_internal" {
  metadata {
    name      = "allow-internal-and-operator"
    namespace = kubernetes_namespace_v1.this["database"].metadata[0].name
  }

  spec {
    pod_selector {}
    policy_types = ["Ingress"]

    ingress {
      from {
        pod_selector {}
      }

      from {
        namespace_selector {
          match_labels = local.ns_selector["cnpg-system"]
        }
      }
    }
  }
}

# `app` chỉ nhận vào từ lối vào (và nội bộ `app`).
resource "kubernetes_network_policy_v1" "app_ingress_only" {
  metadata {
    name      = "allow-from-ingress-and-self"
    namespace = kubernetes_namespace_v1.this["app"].metadata[0].name
  }

  spec {
    pod_selector {}
    policy_types = ["Ingress"]

    ingress {
      from {
        namespace_selector {
          match_labels = local.ns_selector["ingress"]
        }
      }

      from {
        pod_selector {}
      }
    }
  }
}

# ---------------------------------------------------------------- môi trường tạm diễn tập: chặn đi ra

# Mặc định từ chối đi ra ở mọi không gian tên; chỉ cho DNS nội bộ, nội bộ cụm và các dải khai báo (kho tệp, kho ảnh).
resource "kubernetes_network_policy_v1" "drill_default_deny_egress" {
  for_each = local.is_drill ? local.namespaces : {}

  metadata {
    name      = "restrict-egress"
    namespace = kubernetes_namespace_v1.this[each.key].metadata[0].name
  }

  spec {
    pod_selector {}
    policy_types = ["Egress"]

    # DNS của cụm.
    egress {
      ports {
        port     = "53"
        protocol = "UDP"
      }

      ports {
        port     = "53"
        protocol = "TCP"
      }
    }

    # Nội bộ cụm (mọi không gian tên).
    egress {
      to {
        namespace_selector {}
      }
    }

    # Mạng của cụm (API cụm) và điểm cuối kho tệp/kho ảnh đã khai báo.
    dynamic "egress" {
      for_each = var.egress_allowed_cidrs

      content {
        to {
          ip_block {
            cidr = egress.value
          }
        }
      }
    }
  }
}
