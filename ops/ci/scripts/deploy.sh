#!/usr/bin/env bash
# Các chặng của quy trình triển khai (008 US2, contracts/deploy-pipeline.md mục 2). Jenkinsfile.deploy chỉ gọi
# `bash ops/ci/scripts/deploy.sh <chặng>` – KHÔNG có logic triển khai trong Groovy. Chạy trên tác nhân `deploy`, từ gốc
# kho đã hợp nhất. Thông tin xác thực do Jenkins cấp qua biến môi trường (withCredentials), KHÔNG in ra, `set +x`.
#
# Chặng: guard | env-gate | gate-env | image | migrate | rollout | web | smoke | finish | rollback
#        redeploy-prepare | web-redeploy (triển khai lại) | backmerge (sửa nóng) | rerun-gates
# Biến: ENV_NAME (staging|production, suy từ thư mục job), BRANCH_NAME, GIT_COMMIT, JOB_NAME, BUILD_NUMBER, BUILD_URL,
#       REGISTRY_USER/REGISTRY_PASSWORD, KUBE_TOKEN, AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, SMOKE_TOKEN/SMOKE_USER/
#       SMOKE_PASSWORD, GITHUB_TOKEN, TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID, KIND (release|hotfix), REDEPLOY_* (redeploy).
# Tệp trạng thái trong thư mục làm việc: deploy-state.json, image.json, values.yaml, previous.json, rolled-back, gates-summary.json.
set -euo pipefail
set +x
stage="${1:?cần tên chặng}"
cd "$(git rev-parse --show-toplevel)"

ENV_NAME="${ENV_NAME:?cần ENV_NAME}"
# Job Pipeline thường không có BRANCH_NAME: lấy từ GIT_BRANCH (origin/<nhánh>).
BRANCH="${BRANCH_NAME:-${GIT_BRANCH:-}}"; BRANCH="${BRANCH#origin/}"
# Redeploy: DEPLOY_SHA là bản cũ cần đưa lên; triển khai thường: commit đang chạy.
SHA="${DEPLOY_SHA:-${GIT_COMMIT:-$(git rev-parse HEAD)}}"
SHA12="${SHA:0:12}"
STATE=deploy-state.json
# kubeconfig chứa KUBE_TOKEN: luôn xóa khi chặng kết thúc (kể cả lỗi), không để token nằm lại trên đĩa (VII).
trap 'rm -rf .kube' EXIT
get() { node ops/deploy/scripts/env-get.mjs "$ENV_NAME" "$1"; }
record() { node ops/ci/scripts/deployment-record.mjs "$@"; }

# Chạy một chặng có đo thời gian và ghi kết quả; lỗi → ghi `failed` rồi thoát mã khác 0.
run_step() {
  local name="$1"; shift
  local started; started="$(date +%s)"
  if "$@"; then
    record step --name "$name" --status passed --seconds "$(( $(date +%s) - started ))" --state "$STATE"
  else
    record step --name "$name" --status failed --seconds "$(( $(date +%s) - started ))" --state "$STATE"
    return 1
  fi
}

write_kubeconfig() {
  umask 077
  mkdir -p .kube
  cat > .kube/config <<KCFG
apiVersion: v1
kind: Config
clusters:
  - name: target
    cluster: { server: "$(get cluster.server)" }
users:
  - name: ci-deployer
    user: { token: "${KUBE_TOKEN}" }
contexts:
  - name: target
    context: { cluster: target, user: ci-deployer }
current-context: target
KCFG
  export KUBECONFIG="$PWD/.kube/config"
}

registry_login() {
  local repo host
  repo="$(get registry.repository)"
  host="${repo%%/*}"
  printf '%s' "$REGISTRY_PASSWORD" | docker login "$host" -u "$REGISTRY_USER" --password-stdin >/dev/null
}

case "$stage" in
  guard)
    # Không ánh xạ chéo (FR-003): nhánh ≠ params.branch hoặc thư mục job ≠ params.name → dừng ngay.
    [ "$(get name)" = "$ENV_NAME" ] || { echo "✖ Tên môi trường trong tệp tham số khác thư mục job"; exit 1; }
    [ "$BRANCH" = "$(get branch)" ] || { echo "✖ Nhánh ${BRANCH:-?} không phải nhánh của môi trường $ENV_NAME ($(get branch))"; exit 1; }
    record begin --env "$ENV_NAME" --sha "$SHA" --state "$STATE"
    ;;

  env-gate)
    # In `true`/`false`: môi trường đã có chưa (`provisioned`). Không đỏ khi chưa có.
    get provisioned
    ;;

  gate-env)
    # Biến cho các làn kiểm tra: COMPAT_BASE_SHA = bản đang chạy ở CHÍNH môi trường này (nếu có).
    last="$(GITHUB_TOKEN="${GITHUB_TOKEN:-}" record last-success --env "$ENV_NAME" 2>/dev/null || echo null)"
    base="$(node -e 'const r=JSON.parse(process.argv[1]); process.stdout.write(r&&r.commit?r.commit:"none")' "$last")"
    {
      echo "export COMPAT_BASE_SHA=$base"
      echo "export STAGING_DEPLOYED_SHA=$base"
      # `check:release-source` đã chạy trên pull request; trên bản đã hợp nhất thì không áp dụng.
      echo "export GATE_TARGET_BRANCH=none"
      echo "export GATE_SOURCE_BRANCH=$BRANCH"
      [ "$base" = none ] && echo "export MIGRATION_BASE_REF=HEAD~1" || echo "export MIGRATION_BASE_REF=$base"
      echo "export APP_VERSION=$SHA12"
    } > gate-env.sh
    ;;

  image)
    registry_login
    policy="$(get vulnerabilityPolicy)"
    ignore=(); [ -f .trivyignore ] && ignore=(--ignorefile .trivyignore)
    set +e
    run_step image bash -o pipefail -c "node ops/deploy/scripts/release-image.mjs --repository '$(get registry.repository)' --sha '$SHA' --policy '$policy' ${ignore[*]:-} | tee image.log"
    code=$?
    set -e
    tail -n 1 image.log > image.json 2>/dev/null || true
    exit "$code"
    ;;

  migrate)
    write_kubeconfig
    ns="$(get cluster.namespaces.migrate)"
    digest="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("image.json","utf8")).digest)')"
    # Bản đang chạy (để quay về) và danh sách migration mới của lần này.
    prev_commit="$(node -e 'process.stdout.write(JSON.parse(process.argv[1] || "null")?.commit ?? "")' "$(record last-success --env "$ENV_NAME" 2>/dev/null || echo null)")"
    if [ -n "$prev_commit" ] && git cat-file -e "$prev_commit^{commit}" 2>/dev/null; then
      git diff --name-only --diff-filter=A "$prev_commit" "$SHA" -- 'apps/server/drizzle/migrations/*.sql' | xargs -r -n1 basename > migrations.txt
    else
      ls apps/server/drizzle/migrations/*.sql | xargs -n1 basename > migrations.txt
    fi
    run_migrate() {
      if [ "$(kubectl -n "$ns" get job "migrate-$SHA12" -o jsonpath='{.status.succeeded}' 2>/dev/null || true)" = "1" ]; then
        echo "Job migrate-$SHA12 đã thành công – bỏ qua (chạy lại an toàn)"; return 0
      fi
      kubectl -n "$ns" delete job "migrate-$SHA12" --ignore-not-found >/dev/null
      SHA12="$SHA12" NAMESPACE="$ns" IMAGE_REF="$(get registry.repository)@$digest" APP_ENV="$ENV_NAME" DB_OWNER_SECRET="$(get secrets.dbOwner)" \
        envsubst < ops/deploy/migrate-job.yaml | kubectl apply -f -
      kubectl -n "$ns" wait --for=condition=complete "job/migrate-$SHA12" --timeout=600s || { kubectl -n "$ns" logs "job/migrate-$SHA12" --tail=50 || true; return 1; }
    }
    run_step migrate run_migrate
    ;;

  rollout)
    write_kubeconfig
    ns="$(get cluster.namespaces.app)"
    digest="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("image.json","utf8")).digest)')"
    # Ghi bản đang chạy để quay về khi bước web / smoke hỏng.
    rev="$(HELM_DRIVER=configmap helm history app -n "$ns" -o json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const h=JSON.parse(s).filter(r=>r.status==="deployed");process.stdout.write(String(h.length?h[h.length-1].revision:0))}catch{process.stdout.write("0")}})')"
    prev="$(record last-success --env "$ENV_NAME" 2>/dev/null || echo null)"
    node -e 'const p=JSON.parse(process.argv[1]||"null");require("fs").writeFileSync("previous.json",JSON.stringify({commit:p?.commit??"",digest:p?.image?.digest??"",helmRevision:Number(process.argv[2])}))' "$prev" "$rev"
    node ops/deploy/scripts/render-values.mjs --env "$ENV_NAME" --sha "$SHA" --digest "$digest" > values.yaml
    run_rollout() {
      HELM_DRIVER=configmap helm upgrade --install app ops/deploy/chart -n "$ns" -f values.yaml \
        --atomic --wait --timeout "$(get rollout.timeoutSeconds)s"
    }
    # `--atomic`: Helm tự quay về bản trước khi lỗi → đánh dấu đã quay về.
    run_step rollout run_rollout || { touch rolled-back; exit 1; }
    ;;

  web)
    export AWS_REGION="$(get web.s3Region)"
    run_web() {
      node ops/deploy/scripts/publish-web.mjs --env "$ENV_NAME" --sha "$SHA" &&
        node ops/deploy/scripts/publish-web.mjs --env "$ENV_NAME" --sha "$SHA" --activate
    }
    run_step web run_web || { bash "$0" rollback; exit 1; }
    ;;

  smoke)
    run_smoke() { node ops/deploy/smoke/smoke.mjs --env "$ENV_NAME" --expect-version "$SHA"; }
    run_step smoke run_smoke || { bash "$0" rollback; exit 1; }
    ;;

  redeploy-prepare)
    # Triển khai lại bản cũ (FR-034): kiểm tham số, lấy digest từ bản ghi của VERSION, KHÔNG dựng ảnh / chạy migration.
    [ -n "${REDEPLOY_REASON// /}" ] || { echo "✖ REASON là bắt buộc"; exit 1; }
    [[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "✖ VERSION phải là SHA commit đầy đủ 40 ký tự"; exit 1; }
    found="$(record find-success --env "$ENV_NAME" --sha "$SHA")"
    [ "$found" != "null" ] || { echo "✖ ${SHA:0:12} chưa từng triển khai THÀNH CÔNG lên $ENV_NAME"; exit 1; }
    last="$(record last-success --env "$ENV_NAME")"
    previous_commit="$(node -e 'process.stdout.write(JSON.parse(process.argv[1])?.commit ?? "")' "$last")"
    if [ "$SHA" != "$previous_commit" ] && [ "${ACK_OLDER_THAN_PREVIOUS:-false}" != "true" ]; then
      echo "✖ ${SHA:0:12} không phải bản liền trước (${previous_commit:0:12}); cần đánh dấu ACK_OLDER_THAN_PREVIOUS."
      exit 1
    fi
    [ "$SHA" = "$previous_commit" ] || echo "⚠ Tương thích ngược chỉ được kiểm với bản LIỀN TRƯỚC; bản cũ hơn cần SA tự đánh giá."
    digest="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).image.digest)' "$found")"
    registry_login
    docker manifest inspect "$(get registry.repository)@$digest" >/dev/null || { echo "✖ Ảnh $digest không còn trong kho (đã bị dọn?)"; exit 1; }
    node -e 'require("fs").writeFileSync("image.json",JSON.stringify({reused:true,digest:process.argv[1],vulnerabilities:{critical:0,criticalFixable:0,blocked:false}}))' "$digest"
    : > migrations.txt
    ;;

  web-redeploy)
    # Không dựng lại giao diện: kích hoạt bản đã có trong releases/<sha>/.
    export AWS_REGION="$(get web.s3Region)"
    run_web_redeploy() { node ops/deploy/scripts/publish-web.mjs --env "$ENV_NAME" --rollback-to "$SHA"; }
    run_step web run_web_redeploy || { bash "$0" rollback; exit 1; }
    ;;

  backmerge)
    # Sau smoke đạt của một lần sửa nóng: mở pull request đưa về dev và báo Telegram số pull request (SC-009).
    out="$(node ops/ci/scripts/backmerge.mjs --sha "$SHA")" || { echo "✖ không mở được pull request backmerge"; exit 1; }
    echo "$out"
    pr="$(sed -n 's/.*pr=\([0-9]*\).*/\1/p' <<<"$out")"
    note=""; grep -q 'conflict=true' <<<"$out" && note=" – CÓ XUNG ĐỘT (nhãn needs-manual-merge)"
    node ops/ci/scripts/notify-telegram.mjs --text "Bản sửa nóng ${SHA12} đã lên $ENV_NAME. Pull request đưa về dev: #${pr}${note}" || true
    ;;

  rerun-gates)
    # In số pull request dev → master đang mở (Jenkinsfile.deploy gọi tiếp `build job: ci/gates/PR-<số>`).
    node ops/ci/scripts/rerun-release-gates.mjs || true
    ;;

  rollback)
    # Bước 5 hoặc 6 hỏng: quay về bản trước (Helm + index.html), ghi `rolled-back`.
    write_kubeconfig
    ns="$(get cluster.namespaces.app)"
    rev="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync("previous.json","utf8")).helmRevision))')"
    prev_sha="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("previous.json","utf8")).commit)')"
    if [ "$rev" != "0" ]; then HELM_DRIVER=configmap helm rollback app "$rev" -n "$ns" --wait --timeout 8m || true; fi
    if [ -n "$prev_sha" ]; then
      AWS_REGION="$(get web.s3Region)" node ops/deploy/scripts/publish-web.mjs --env "$ENV_NAME" --rollback-to "$prev_sha" || true
    fi
    touch rolled-back
    ;;

  finish)
    # Kết quả: noenv | succeeded | rolled_back | stopped_before_change. KHÔNG làm đổi kết quả triển khai nếu lỗi gửi tin.
    provisioned="$(get provisioned)"
    failed="$(node -e 'const s=require("fs").existsSync("deploy-state.json")?JSON.parse(require("fs").readFileSync("deploy-state.json","utf8")):{steps:[]};process.stdout.write(s.steps.find(x=>x.status==="failed")?.name??"")')"
    # Lỗi không thuộc bước nào (hạ tầng, cài phụ thuộc…) vẫn là "hỏng" chứ không phải thành công.
    if [ -z "$failed" ] && [ "${BUILD_RESULT:-SUCCESS}" != "SUCCESS" ]; then failed=unknown; fi
    if [ "$provisioned" != "true" ] && [ -z "$failed" ]; then result=no_target
    elif [ "$provisioned" != "true" ]; then result=stopped_before_change
    elif [ -f rolled-back ]; then result=rolled_back
    elif [ -n "$failed" ]; then result=stopped_before_change
    else result=succeeded; fi
    summary='{"passed":true,"excepted":[]}'; [ -f gates-summary.json ] && summary="$(cat gates-summary.json)"
    gates_passed="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).passed))' "$summary")"
    excepted="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).excepted.join(","))' "$summary")"
    img='{}'; [ -f image.json ] && img="$(cat image.json)"
    field() { node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(String(o'"$1"'??""))' "$img"; }
    prev='{}'; [ -f previous.json ] && prev="$(cat previous.json)"
    migrations=""; [ -f migrations.txt ] && migrations="$(paste -sd, migrations.txt)"
    extra=()
    if [ "${KIND:-release}" = redeploy ]; then
      extra=(--redeploy-by "${REDEPLOY_BY:-}" --redeploy-reason "${REDEPLOY_REASON:-}" --redeploy-version "$SHA")
    fi
    if [ "$result" != no_target ]; then
      record finish "${extra[@]}" --result "$result" --kind "${KIND:-release}" --state "$STATE" \
        --image-repository "$(get registry.repository)" --image-digest "$(field .digest)" \
        $([ "$(field .reused)" = "true" ] && echo --image-reused) \
        --gates-passed "$gates_passed" --excepted "$excepted" \
        --vuln-critical "$(field .vulnerabilities.critical)" --vuln-fixable "$(field .vulnerabilities.criticalFixable)" --vuln-blocked "$(field .vulnerabilities.blocked)" \
        --migrations "$migrations" --job "$JOB_NAME" --build "$BUILD_NUMBER" --url "$BUILD_URL" \
        --previous-commit "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).commit??"")' "$prev")" \
        --previous-digest "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).digest??"")' "$prev")" \
        --previous-helm-revision "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).helmRevision??0))' "$prev")" \
        $([ -f rolled-back ] && echo --rolled-back) || echo "notifyErrors: không ghi được bản ghi triển khai"
    fi
    case "$result" in
      succeeded) msg=success ;; rolled_back) msg=rolledback ;; stopped_before_change) msg=failed ;; *) msg=noenv ;;
    esac
    node ops/ci/scripts/notify-telegram.mjs --env "$ENV_NAME" --result "$msg" --sha "$SHA" --failed-step "$failed" \
      --migrations "$(wc -l < migrations.txt 2>/dev/null || echo 0)" --vulns "$(field .vulnerabilities.critical)" \
      --excepted "$excepted" --url "$BUILD_URL" || true
    ;;

  *)
    echo "Chặng không hợp lệ: $stage" >&2; exit 2 ;;
esac
