# RBAC (T042, FR-014): mỗi ServiceAccount chỉ `get` đúng MỘT Secret qua `resourceNames`.
# Terraform KHÔNG tạo đối tượng `Secret` – giá trị do `pnpm infra secrets init` tạo (research R8).

locals {
  service_accounts = {
    api     = "api-secrets"
    worker  = "worker-secrets"
    migrate = "migrate-secrets"
  }
  registry_pull_secret = "registry-pull"

  # Môi trường tạm diễn tập không chạy ứng dụng: không ServiceAccount api/worker (chỉ migrate để dựng lược đồ nếu cần).
  active_service_accounts = local.is_drill ? {} : local.service_accounts
}

resource "kubernetes_service_account_v1" "this" {
  for_each = local.active_service_accounts

  metadata {
    name      = each.key
    namespace = kubernetes_namespace_v1.this["app"].metadata[0].name
    labels    = merge(local.base_labels, { component = each.key })
  }

  # Kho ảnh riêng tư: Secret `registry-pull` do CLI tạo.
  image_pull_secret {
    name = local.registry_pull_secret
  }
}

resource "kubernetes_role_v1" "read_own_secret" {
  for_each = local.active_service_accounts

  metadata {
    name      = "${each.key}-read-secret"
    namespace = kubernetes_namespace_v1.this["app"].metadata[0].name
    labels    = merge(local.base_labels, { component = each.key })
  }

  rule {
    api_groups     = [""]
    resources      = ["secrets"]
    verbs          = ["get"]
    resource_names = [each.value]
  }
}

resource "kubernetes_role_binding_v1" "read_own_secret" {
  for_each = local.active_service_accounts

  metadata {
    name      = "${each.key}-read-secret"
    namespace = kubernetes_namespace_v1.this["app"].metadata[0].name
    labels    = merge(local.base_labels, { component = each.key })
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Role"
    name      = kubernetes_role_v1.read_own_secret[each.key].metadata[0].name
  }

  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account_v1.this[each.key].metadata[0].name
    namespace = kubernetes_namespace_v1.this["app"].metadata[0].name
  }
}
