# Toán tử CloudNativePG và trình cắm Barman Cloud vào `cnpg-system` (T045). Trình cắm cần cert-manager (đã cài ở
# platform-base) để cấp chứng chỉ cho kết nối giữa toán tử và trình cắm.

resource "helm_release" "cnpg_operator" {
  name       = "cnpg"
  namespace  = "cnpg-system"
  repository = "https://cloudnative-pg.github.io/charts"
  chart      = "cloudnative-pg"
  version    = var.chart_versions["cnpg"]

  wait    = true
  timeout = 600
}

resource "helm_release" "barman_cloud" {
  name       = "barman-cloud"
  namespace  = "cnpg-system"
  repository = "https://cloudnative-pg.github.io/charts"
  chart      = "plugin-barman-cloud"
  version    = var.chart_versions["barman_cloud"]

  wait    = true
  timeout = 600

  depends_on = [helm_release.cnpg_operator]
}
