# Chứng chỉ (T041): cert-manager + ClusterIssuer `letsencrypt` (ACME, HTTP-01 qua lớp `nginx`). Tự gia hạn.
# ClusterIssuer đóng gói trong biểu đồ Helm cục bộ để tránh `kubernetes_manifest` (cần CRD ngay lúc lập kế hoạch).

resource "helm_release" "cert_manager" {
  name       = "cert-manager"
  namespace  = kubernetes_namespace_v1.this["cert-manager"].metadata[0].name
  repository = "https://charts.jetstack.io"
  chart      = "cert-manager"
  version    = var.chart_versions["cert_manager"]

  wait    = true
  timeout = 600

  set {
    name  = "crds.enabled"
    value = "true"
  }

  # Chỉ số `certmanager_certificate_expiration_timestamp_seconds` cho H3 cảnh báo hạn (< 14 ngày).
  set {
    name  = "prometheus.enabled"
    value = "true"
  }
}

resource "helm_release" "cluster_issuer" {
  count = local.create_ingress ? 1 : 0

  name      = "cluster-issuer"
  namespace = kubernetes_namespace_v1.this["cert-manager"].metadata[0].name
  chart     = "${path.module}/charts/cluster-issuer"

  wait = true

  values = [yamlencode({
    issuerName   = "letsencrypt"
    email        = var.acme_email
    ingressClass = "nginx"
  })]

  depends_on = [helm_release.cert_manager]
}
