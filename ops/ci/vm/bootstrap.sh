#!/usr/bin/env bash
# Dựng máy Jenkins từ máy Ubuntu LTS trống (008, contracts/jenkins-platform.md mục 1–3, 6). Chạy bằng root, CHẠY LẠI
# NHIỀU LẦN an toàn (idempotent). Do cloud-init gọi sau `terraform apply`; cũng chạy tay được: sudo bash bootstrap.sh
#
# Biến môi trường (không bí mật):
#   REPO_DIR      thư mục chứa bản sao kho mã (mặc định /opt/app-repo) – lấy ops/ci/** từ đây
#   DATA_DEVICE   thiết bị đĩa dữ liệu cho JENKINS_HOME (vd /dev/vdb); bỏ trống = dùng thư mục thường
#   ADMIN_CIDRS   danh sách CIDR của đội, cách nhau bằng dấu phẩy (cho nginx và SSH)
# KHÔNG ghi giá trị bí mật nào – /etc/jenkins-secrets/ chỉ được TẠO RỖNG; SA nhập tay theo docs/ci-cd/credentials.md.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/app-repo}"
DATA_DIR=/var/lib/jenkins-data
SECRETS_DIR=/etc/jenkins-secrets
VERSIONS="$REPO_DIR/ops/ci/versions.env"

log() { printf '▸ %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng root" >&2; exit 1; }
[ -f "$VERSIONS" ] || { echo "Không thấy $VERSIONS – đặt REPO_DIR trỏ tới bản sao kho mã" >&2; exit 1; }
# shellcheck disable=SC1090
. "$VERSIONS"

# ---------- 1. Gói hệ thống ----------
log "Gói hệ thống"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl xz-utils git nginx nftables openjdk-21-jre-headless \
  uidmap dbus-user-session slirp4netns fuse-overlayfs docker.io docker-compose-v2 jq
# Docker hệ thống chỉ cung cấp bộ công cụ rootless; daemon hệ thống TẮT (không người dùng nào dùng).
systemctl disable --now docker.service docker.socket 2>/dev/null || true

# ---------- 2. Ba người dùng tách biệt ----------
log "Người dùng jenkins / ci-agent / deploy-agent"
for u in jenkins ci-agent deploy-agent; do
  id "$u" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --user-group "$u"
  chmod 0700 "/home/$u"
done
# ci-agent không sudo, không nhóm docker hệ thống (rootless có daemon riêng).
gpasswd -d ci-agent docker 2>/dev/null || true
gpasswd -d ci-agent sudo 2>/dev/null || true
gpasswd -d deploy-agent docker 2>/dev/null || true
# Cả ba người dùng có Docker rootless RIÊNG (bộ điều khiển Jenkins chạy trong daemon của `jenkins`).
for u in jenkins ci-agent deploy-agent; do
  grep -q "^$u:" /etc/subuid || usermod --add-subuids 100000-165535 --add-subgids 100000-165535 "$u"
  loginctl enable-linger "$u"
  # Docker rootless riêng (cài một lần; bộ cài tự bỏ qua nếu đã có).
  if [ ! -S "/run/user/$(id -u "$u")/docker.sock" ]; then
    sudo -u "$u" XDG_RUNTIME_DIR="/run/user/$(id -u "$u")" dockerd-rootless-setuptool.sh install || true
  fi
done

# ---------- 3. Đĩa dữ liệu cho JENKINS_HOME ----------
log "Đĩa dữ liệu $DATA_DIR"
mkdir -p "$DATA_DIR"
if [ -n "${DATA_DEVICE:-}" ] && ! mountpoint -q "$DATA_DIR"; then
  blkid "$DATA_DEVICE" >/dev/null 2>&1 || mkfs.ext4 -L jenkins-data "$DATA_DEVICE"
  grep -q "$DATA_DIR" /etc/fstab || echo "LABEL=jenkins-data $DATA_DIR ext4 defaults,nofail 0 2" >> /etc/fstab
  mount "$DATA_DIR"
fi
mkdir -p "$DATA_DIR/audit"
chown -R jenkins:jenkins "$DATA_DIR"
chmod 0700 "$DATA_DIR"

# ---------- 4. helm / kubectl / trivy – CHỈ cho deploy-agent, có kiểm SHA-256 (R19) ----------
log "helm, kubectl, trivy (chỉ deploy-agent)"
BIN=/home/deploy-agent/bin
install -d -o deploy-agent -g deploy-agent -m 0700 "$BIN"
fetch_verified() { # url sha256 đích
  local tmp; tmp="$(mktemp)"
  curl -fsSL "$1" -o "$tmp"
  echo "$2  $tmp" | sha256sum -c - >/dev/null || { echo "Sai mã băm SHA-256 cho $1" >&2; rm -f "$tmp"; exit 1; }
  mv "$tmp" "$3"
}
if [ ! -x "$BIN/helm" ] || ! "$BIN/helm" version --short 2>/dev/null | grep -q "${HELM_VERSION#v}"; then
  fetch_verified "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" "$HELM_SHA256_LINUX_AMD64" /tmp/helm.tgz
  tar -xzf /tmp/helm.tgz -C /tmp linux-amd64/helm && install -o deploy-agent -g deploy-agent -m 0700 /tmp/linux-amd64/helm "$BIN/helm"
fi
if [ ! -x "$BIN/kubectl" ] || ! "$BIN/kubectl" version --client 2>/dev/null | grep -q "$KUBECTL_VERSION"; then
  fetch_verified "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" "$KUBECTL_SHA256_LINUX_AMD64" /tmp/kubectl
  install -o deploy-agent -g deploy-agent -m 0700 /tmp/kubectl "$BIN/kubectl"
fi
if [ ! -x "$BIN/trivy" ] || ! "$BIN/trivy" --version 2>/dev/null | grep -q "${TRIVY_VERSION#v}"; then
  fetch_verified "https://github.com/aquasecurity/trivy/releases/download/${TRIVY_VERSION}/trivy_${TRIVY_VERSION#v}_Linux-64bit.tar.gz" "$TRIVY_SHA256_LINUX_AMD64" /tmp/trivy.tgz
  tar -xzf /tmp/trivy.tgz -C /tmp trivy && install -o deploy-agent -g deploy-agent -m 0700 /tmp/trivy "$BIN/trivy"
fi
grep -q 'home/deploy-agent/bin' /home/deploy-agent/.profile 2>/dev/null || echo 'export PATH="$HOME/bin:$PATH"' >> /home/deploy-agent/.profile

# ---------- 4b. Node.js cho tập lệnh của đường ống (có kiểm SHA-256) ----------
log "Node.js ${NODE_VERSION}"
if ! /opt/node/bin/node --version 2>/dev/null | grep -qx "${NODE_VERSION}"; then
  fetch_verified "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" "$NODE_SHA256_LINUX_X64" /tmp/node.tar.xz
  rm -rf /opt/node && mkdir -p /opt/node
  tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
fi
ln -sf /opt/node/bin/node /usr/local/bin/node
ln -sf /opt/node/bin/corepack /usr/local/bin/corepack

# ---------- 5. Bí mật: chỉ tạo thư mục rỗng ----------
log "Thư mục bí mật $SECRETS_DIR (rỗng – SA nhập tay)"
install -d -o jenkins -g jenkins -m 0500 "$SECRETS_DIR" "$SECRETS_DIR/staging" "$SECRETS_DIR/production"
install -d -m 0755 /etc/jenkins-agent /opt/jenkins-agent

# ---------- 6. nftables + nginx ----------
log "nftables, nginx"
install -d /etc/nftables.d
[ -f /etc/nftables.d/ci-targets.nft ] || : > /etc/nftables.d/ci-targets.nft   # điền khi có địa chỉ môi trường (007)
if [ -n "${ADMIN_CIDRS:-}" ]; then
  # Cùng danh sách cho nginx (allow) và nftables (admin_cidrs).
  : > /etc/nginx/admin-cidrs.conf
  IFS=',' read -ra CIDRS <<<"$ADMIN_CIDRS"
  for c in "${CIDRS[@]}"; do echo "allow ${c// /};" >> /etc/nginx/admin-cidrs.conf; done
  { echo "add element inet ci admin_cidrs { $(IFS=,; echo "${CIDRS[*]}") }"; } > /etc/nftables.d/ci-admin.nft
fi
[ -f /etc/nginx/admin-cidrs.conf ] || : > /etc/nginx/admin-cidrs.conf
install -m 0644 "$REPO_DIR/ops/ci/vm/nftables.conf" /etc/nftables.conf
install -m 0644 "$REPO_DIR/ops/ci/vm/nginx.conf" /etc/nginx/nginx.conf
systemctl enable --now nftables
nft -f /etc/nftables.conf
[ -f /etc/nftables.d/ci-admin.nft ] && nft -f /etc/nftables.d/ci-admin.nft
nginx -t && systemctl enable --now nginx && systemctl reload nginx

# ---------- 7. Đơn vị systemd của hai tác nhân ----------
log "Đơn vị systemd"
install -m 0644 "$REPO_DIR/ops/ci/vm/systemd/jenkins-agent-ci.service" /etc/systemd/system/
install -m 0644 "$REPO_DIR/ops/ci/vm/systemd/jenkins-agent-deploy.service" /etc/systemd/system/
systemctl daemon-reload
# Tác nhân chỉ khởi động sau khi SA nhập bí mật kết nối (docs/ci-cd/rebuild-jenkins.md bước 4).
systemctl enable jenkins-agent-ci.service jenkins-agent-deploy.service

# ---------- 8. Bộ điều khiển ----------
log "Bộ điều khiển Jenkins"
JENKINS_UID="$(id -u jenkins)" JENKINS_GID="$(id -g jenkins)" \
  docker compose -f "$REPO_DIR/ops/ci/jenkins/compose.yaml" up -d --build

log "Xong. Việc còn lại là nhập bí mật vào $SECRETS_DIR theo docs/ci-cd/credentials.md."
