# Lối vào (T040): NGINX Ingress Controller của F5/NGINX (bản mã nguồn mở), biểu đồ `nginx-ingress` cố định phiên bản.
# KHÔNG dùng `kubernetes/ingress-nginx` của cộng đồng (đã ngừng bảo trì – research R5). Ứng dụng chỉ khai `Ingress`
# chuẩn, nên đổi bộ điều khiển không đụng H2. Không cài ở môi trường tạm diễn tập.

resource "helm_release" "ingress" {
  count = local.create_ingress ? 1 : 0

  name       = "ingress"
  namespace  = kubernetes_namespace_v1.this["ingress"].metadata[0].name
  repository = "https://helm.nginx.com/stable"
  chart      = "nginx-ingress"
  version    = var.chart_versions["ingress"]

  wait    = true
  timeout = 600

  values = [yamlencode({
    controller = {
      ingressClass = {
        name                = "nginx"
        create              = true
        setAsDefaultIngress = true
      }

      # Cần cho tiêu đề noindex toàn cục.
      enableSnippets = !var.search_indexing

      config = {
        entries = merge(
          { "ssl-redirect" = "true" },
          var.search_indexing ? {} : {
            "location-snippets" = "add_header X-Robots-Tag \"noindex, nofollow\" always;"
          },
        )
      }

      service = {
        type        = "LoadBalancer"
        annotations = var.ingress_service_annotations
      }
    }
  })]
}
