#!/usr/bin/env bash
# Chạy MỘT làn của gate-lanes.json trong ảnh công cụ (008 T056): `pnpm verify --ci --only <bước của làn>`, ghi báo
# cáo `verify-report-<làn>.json` và nhật ký `lane-<làn>.log` (nhật ký được quét bí mật ở cuối lần chạy).
# Làn db/e2e/image cần PostgreSQL tạm (TEST_POSTGRES_IMAGE trong ops/ci/versions.env) – tạo trên mạng riêng của
# lần chạy và LUÔN hủy khi xong. Biến cổng (STAGING_DEPLOYED_SHA, COMPAT_BASE_SHA, …) lấy từ gate-env.sh.
# Dùng: bash ops/ci/scripts/run-lane.sh <static|db|e2e|image>
set -euo pipefail
lane="${1:?cần tên làn}"
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "$here/toolchain.sh"
# shellcheck disable=SC1091
. ops/ci/versions.env
# shellcheck disable=SC1091
[ -f gate-env.sh ] && . ./gate-env.sh

steps="$(run_in_toolchain -- node ops/ci/scripts/lane-steps.mjs "$lane")"
report="verify-report-$lane.json"
log="lane-$lane.log"
env_args=()
for key in STAGING_DEPLOYED_SHA COMPAT_BASE_SHA GATE_TARGET_BRANCH GATE_SOURCE_BRANCH MIGRATION_BASE_REF APP_VERSION; do
  [ -n "${!key:-}" ] && env_args+=(-e "$key=${!key}")
done

network_args=()
suffix="${BUILD_TAG:-local}-$lane"
suffix="$(echo "$suffix" | tr -c 'a-zA-Z0-9_.-\n' '-')"
cleanup() { docker rm -f "pg-$suffix" >/dev/null 2>&1 || true; docker network rm "net-$suffix" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if [ "$lane" != "static" ]; then
  docker network create "net-$suffix" >/dev/null
  docker run -d --name "pg-$suffix" --network "net-$suffix" -e POSTGRES_PASSWORD=ci_only_throwaway \
    "$TEST_POSTGRES_IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "pg-$suffix" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  network_args=(--network "net-$suffix")
  env_args+=(-e "TEST_DATABASE_ADMIN_URL=postgres://postgres:ci_only_throwaway@pg-$suffix:5432/postgres")
fi

set +e
run_in_toolchain "${network_args[@]}" "${env_args[@]}" -- \
  pnpm verify --ci --only "$steps" --report "$report" 2>&1 | tee "$log"
code="${PIPESTATUS[0]}"
set -e
# Mã thoát của làn KHÔNG làm hỏng chặng: kết quả quyết định ở bước đăng kiểm tra từ các báo cáo.
echo "lane=$lane exit=$code"
exit 0
