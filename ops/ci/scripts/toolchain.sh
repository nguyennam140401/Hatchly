#!/usr/bin/env bash
# Dùng chung cho các làn kiểm tra trên tác nhân `ci` (008 R9): dựng ảnh công cụ (cache theo nội dung Dockerfile) và
# chạy một lệnh bên trong ảnh. Được `source` bởi run-lane.sh và Jenkinsfile.ci; KHÔNG chứa bí mật.
set -euo pipefail

# Trên Jenkins: ảnh dựng từ bản TIN CẬY (nhánh dev). GITHUB_TOKEN KHÔNG bao giờ được chuyển mặc định vào ảnh –
# chỉ bước đăng kết quả truyền `-e GITHUB_TOKEN` tường minh (và chỉ chạy mã tin cậy).
TOOLCHAIN_DIR="${TOOLCHAIN_DIR:-ops/ci/toolchain}"

toolchain_image() {
  local hash
  hash="$(sha256sum "$TOOLCHAIN_DIR/Dockerfile" | cut -c1-12)"
  local tag="app-ci-toolchain:$hash"
  if ! docker image inspect "$tag" >/dev/null 2>&1; then
    docker build -t "$tag" -f "$TOOLCHAIN_DIR/Dockerfile" "$TOOLCHAIN_DIR" >&2
  fi
  echo "$tag"
}

# run_in_toolchain [--network <mạng>] [-e KEY=VALUE ...] -- <lệnh...>
run_in_toolchain() {
  local image network_args=() env_args=()
  image="$(toolchain_image)"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --network) network_args=(--network "$2"); shift 2 ;;
      -e) env_args+=(-e "$2"); shift 2 ;;
      --) shift; break ;;
      *) break ;;
    esac
  done
  # Docker rootless của tác nhân: gắn socket để check:image / db:compat dựng ảnh; ảnh không chứa daemon.
  local sock="${DOCKER_HOST:-unix:///run/user/$(id -u)/docker.sock}"
  sock="${sock#unix://}"
  docker run --rm --user "$(id -u):$(id -g)" \
    -v "$PWD:/workspace" -v "$sock:/var/run/docker.sock" -e DOCKER_HOST=unix:///var/run/docker.sock \
    -e HOME=/tmp -e CI=true \
    "${network_args[@]}" "${env_args[@]}" "$image" "$@"
}
