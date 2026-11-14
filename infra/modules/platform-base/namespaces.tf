# Không gian tên, hạn mức và giới hạn mặc định (T038). Ngân sách theo research R5 (một máy 4 vCPU / 8 GB).

resource "kubernetes_namespace_v1" "this" {
  for_each = local.namespaces

  metadata {
    name = each.key

    labels = merge(
      local.base_labels,
      { component = each.key },
      each.value.data ? { data = "true" } : {},
    )
  }
}

# `app`: api 2 × (0,25 CPU / 512 MB) + worker 2 × (0,5 CPU / 1,5 GB) + lối thoát cho migration và dư.
resource "kubernetes_resource_quota_v1" "app" {
  metadata {
    name      = "app-budget"
    namespace = kubernetes_namespace_v1.this["app"].metadata[0].name
  }

  spec {
    hard = {
      "requests.cpu"    = "2"
      "requests.memory" = "5Gi"
      "limits.cpu"      = "4"
      "limits.memory"   = "7Gi"
      "pods"            = "30"
    }
  }
}

resource "kubernetes_limit_range_v1" "app" {
  metadata {
    name      = "app-defaults"
    namespace = kubernetes_namespace_v1.this["app"].metadata[0].name
  }

  spec {
    limit {
      type = "Container"

      default_request = {
        cpu    = "100m"
        memory = "128Mi"
      }

      default = {
        cpu    = "1"
        memory = "1Gi"
      }
    }
  }
}

# `monitoring`: chỉ giữ chỗ cho H3 (không cài gì) – ResourceQuota theo `monitoring_reserved`.
resource "kubernetes_resource_quota_v1" "monitoring" {
  metadata {
    name      = "monitoring-reserved"
    namespace = kubernetes_namespace_v1.this["monitoring"].metadata[0].name
  }

  spec {
    hard = {
      "requests.cpu"     = var.monitoring_reserved.cpu
      "requests.memory"  = var.monitoring_reserved.memory
      "requests.storage" = "${var.monitoring_reserved.storage_gb}Gi"
    }
  }
}
