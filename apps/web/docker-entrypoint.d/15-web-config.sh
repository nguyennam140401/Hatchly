#!/bin/sh
# Sinh hai tệp include cho nginx.conf lúc khởi động ảnh `web` (007, T013, research R7).
# Chạy trước `20-envsubst-on-templates.sh` của ảnh nginx chính thức (thứ tự theo tên tệp).
#
#   API_UPSTREAM     Đặt (vd http://api:3000) → bật khối chuyển tiếp /api, /healthz, /readyz (docker compose).
#                    Không đặt → KHÔNG có khối này (môi trường thật: giao diện gọi thẳng api.<tên miền>).
#   SEARCH_INDEXING  `true` → cho công cụ tìm kiếm lập chỉ mục. Mặc định `false` → thêm
#                    `X-Robots-Tag: noindex, nofollow` (thử nghiệm không được lên kết quả tìm kiếm).
set -eu

DIR=/etc/nginx/web-includes
mkdir -p "$DIR"

if [ -n "${API_UPSTREAM:-}" ]; then
  cat >"$DIR/api-proxy.conf" <<EOF
location ~ ^/(api/|healthz\$|readyz\$) {
  proxy_pass ${API_UPSTREAM};
  proxy_set_header Host \$host;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto \$scheme;
}
EOF
  echo "15-web-config: bật chuyển tiếp /api tới ${API_UPSTREAM}"
else
  : >"$DIR/api-proxy.conf"
  echo "15-web-config: API_UPSTREAM không đặt – không chuyển tiếp /api"
fi

if [ "${SEARCH_INDEXING:-false}" = "true" ]; then
  : >"$DIR/robots.conf"
else
  printf '%s\n' 'add_header X-Robots-Tag "noindex, nofollow" always;' >"$DIR/robots.conf"
fi
