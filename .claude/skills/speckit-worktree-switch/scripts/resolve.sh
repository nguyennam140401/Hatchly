#!/usr/bin/env bash
# Xác định ngữ cảnh worktree cho hook speckit-worktree-switch.
# Dùng: resolve.sh [MÃ_TÍNH_NĂNG]   (vd 003 hoặc 003-queue-layer-pgboss)
# In các dòng KEY=VALUE; mã lỗi khác 0 kèm dòng ERROR=... khi không xác định được.
set -u

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR=NOT_GIT"; exit 2; }

common=$(git rev-parse --path-format=absolute --git-common-dir)
gitdir=$(git rev-parse --path-format=absolute --git-dir)
ROOT=$(dirname "$common")
CUR_TOP=$(git rev-parse --show-toplevel)
IN_WT=false
[ "$common" != "$gitdir" ] && IN_WT=true

echo "ROOT=$ROOT"
echo "CUR_TOP=$CUR_TOP"
echo "IN_WT=$IN_WT"
echo "CUR_BRANCH=$(git branch --show-current)"
echo "ROOT_BRANCH=$(git -C "$ROOT" branch --show-current)"

token=${1:-}
[ -z "$token" ] && exit 0

if ! printf '%s' "$token" | grep -Eq '^[0-9]{3}(-[a-z0-9-]+)?$'; then
  echo "ERROR=BAD_TOKEN"; exit 3
fi
num=${token:0:3}

# Spec luôn tạo ở repo chính (specify chạy ở nhánh chính) → tìm trong <ROOT>/specs.
matches=$(cd "$ROOT/specs" 2>/dev/null && ls -d "${num}"-*/ 2>/dev/null | sed 's#/$##')
if [ "$token" != "$num" ]; then
  matches=$(printf '%s\n' "$matches" | grep -Fx "$token")
fi
count=$(printf '%s' "$matches" | grep -c . || true)
if [ "$count" -eq 0 ]; then echo "ERROR=FEATURE_NOT_FOUND"; exit 4; fi
if [ "$count" -gt 1 ]; then
  echo "ERROR=AMBIGUOUS"; printf 'CANDIDATE=%s\n' $matches; exit 5
fi

FEATURE=$matches
WT="$ROOT/.claude/worktrees/$FEATURE"
BR="impl/$FEATURE"
WT_EXISTS=false
git -C "$ROOT" worktree list --porcelain | grep -Fxq "worktree $WT" && WT_EXISTS=true
BR_EXISTS=false
git -C "$ROOT" rev-parse --verify --quiet "refs/heads/$BR" >/dev/null && BR_EXISTS=true
CUR_IS_WT=false
[ "$CUR_TOP" = "$WT" ] && CUR_IS_WT=true

echo "FEATURE=$FEATURE"
echo "NNN=$num"
echo "FEATURE_DIR=specs/$FEATURE"
echo "WT=$WT"
echo "BR=$BR"
echo "WT_EXISTS=$WT_EXISTS"
echo "BR_EXISTS=$BR_EXISTS"
echo "CUR_IS_WT=$CUR_IS_WT"
