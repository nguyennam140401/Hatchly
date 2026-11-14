#!/usr/bin/env bash
# Merge nhánh gốc (đọc từ tệp .base) vào worktree hiện tại. Chạy từ trong worktree.
# In KEY=VALUE; STATUS = SKIP_MAIN | UP_TO_DATE | MERGED | DIRTY | CONFLICT | ERROR
set -u
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "STATUS=SKIP_MAIN"; exit 0; }
common=$(git rev-parse --path-format=absolute --git-common-dir)
gitdir=$(git rev-parse --path-format=absolute --git-dir)
[ "$common" = "$gitdir" ] && { echo "STATUS=SKIP_MAIN"; exit 0; }

ROOT=$(dirname "$common")
TOP=$(git rev-parse --show-toplevel)
FEATURE=$(basename "$TOP")
BASE=$(cat "$ROOT/.claude/worktrees/$FEATURE.base" 2>/dev/null || echo dev)
echo "FEATURE=$FEATURE"; echo "BASE=$BASE"

if [ -n "$(git status --porcelain)" ]; then
  echo "STATUS=DIRTY"; git status --porcelain | sed 's/^/OTHER:/'; exit 3
fi

if git fetch origin "$BASE" >/dev/null 2>&1; then echo "FETCH=ok"; else echo "FETCH=failed"; fi

before=$(git rev-parse HEAD)
pkg_before=$(git rev-parse HEAD:pnpm-lock.yaml 2>/dev/null || true)

refs="$BASE"
git rev-parse --verify --quiet "refs/remotes/origin/$BASE" >/dev/null && refs="$refs origin/$BASE"
for r in $refs; do
  git merge-base --is-ancestor "$r" HEAD 2>/dev/null && continue
  if ! git merge --no-edit "$r" >/dev/null 2>&1; then
    echo "STATUS=CONFLICT"; echo "REF=$r"
    git diff --name-only --diff-filter=U | sed 's/^/CONFLICT_FILE:/'
    git merge --abort 2>/dev/null
    exit 4
  fi
done

after=$(git rev-parse HEAD)
if [ "$before" = "$after" ]; then echo "STATUS=UP_TO_DATE"; exit 0; fi
echo "STATUS=MERGED"
echo "NEW_COMMITS=$(git rev-list --count "$before..$after")"
pkg_after=$(git rev-parse HEAD:pnpm-lock.yaml 2>/dev/null || true)
[ "$pkg_before" != "$pkg_after" ] && echo "LOCK_CHANGED=true"
exit 0
