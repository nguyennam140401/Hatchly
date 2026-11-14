#!/usr/bin/env bash
# Áp hai bộ luật bảo vệ nhánh (008 R7) lên GitHub bằng `gh api`. CHẠY LẠI NHIỀU LẦN an toàn: chưa có thì tạo, đã
# có thì cập nhật. In khác biệt trước khi áp và HỎI XÁC NHẬN (đây là thao tác hướng ra ngoài).
# Dùng:  GITHUB_APP_CI_ID=<id số của GitHub App "ci"> bash ops/ci/github/apply-rulesets.sh [--yes]
# Cần: gh đã đăng nhập bằng tài khoản có quyền quản trị kho; node; jq. Kho riêng tư cần gói GitHub trả phí.
set -euo pipefail
cd "$(dirname "$0")/../../.."

REPO="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
DIR=ops/ci/github/rulesets
[ -n "${GITHUB_APP_CI_ID:-}" ] || { echo "Cần GITHUB_APP_CI_ID (mã số của GitHub App 'ci', không phải bí mật)" >&2; exit 1; }

echo "▸ Kho: $REPO"
echo "▸ Khác biệt so với luật đang áp (nếu có):"
GITHUB_TOKEN="$(gh auth token)" node ops/ci/scripts/ruleset-drift.mjs --diff-only --repo "$REPO" || true

if [ "${1:-}" != "--yes" ]; then
  read -r -p "Áp các luật trên lên $REPO? [y/N] " answer
  [ "$answer" = "y" ] || { echo "Đã hủy, không thay đổi gì."; exit 0; }
fi

existing="$(gh api "repos/$REPO/rulesets?per_page=100")"
for file in "$DIR"/*.json; do
  name="$(jq -r .name "$file")"
  # Gắn nguồn bắt buộc của `ci/gates` là GitHub App "ci" (FR-002) – mã số App không phải bí mật.
  body="$(jq --argjson app "$GITHUB_APP_CI_ID" \
    '(.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[]) |= . + {integration_id: $app}' "$file")"
  id="$(jq -r --arg n "$name" '.[] | select(.name==$n) | .id' <<<"$existing" | head -n1)"
  if [ -z "$id" ]; then
    echo "▸ Tạo $name"
    gh api -X POST "repos/$REPO/rulesets" --input - <<<"$body" >/dev/null
  else
    echo "▸ Cập nhật $name (id $id)"
    gh api -X PUT "repos/$REPO/rulesets/$id" --input - <<<"$body" >/dev/null
  fi
done
echo "✔ Xong. Kiểm lại: GITHUB_TOKEN=\$(gh auth token) node ops/ci/scripts/ruleset-drift.mjs --diff-only"
