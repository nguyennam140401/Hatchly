#!/usr/bin/env bash
# Xóa worktree của một tính năng (dùng bởi speckit-worktree-finish).
# Dùng: remove.sh <ROOT> <FEATURE> [--discard]
#   Không --discard: từ chối nếu worktree còn thay đổi đã theo dõi chưa commit.
# Trên Windows, `git worktree remove` hay lỗi "Result too large" với node_modules của pnpm,
# nên xóa node_modules bằng rm -rf trước, rồi để git gỡ phần còn lại.
set -u
ROOT=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir | xargs dirname)
FEATURE=$2; DISCARD=${3:-}
WT="$ROOT/.claude/worktrees/$FEATURE"

if [ -d "$WT" ] && [ "$DISCARD" != "--discard" ]; then
  if [ -n "$(git -C "$WT" status --porcelain --untracked-files=no)" ]; then
    echo "ERROR=TRACKED_CHANGES"; git -C "$WT" status --short --untracked-files=no; exit 2
  fi
fi

if [ -d "$WT" ]; then
  find "$WT" -name node_modules -type d -prune -exec rm -rf {} + 2>/dev/null
  git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"
fi
git -C "$ROOT" worktree prune
[ -d "$WT" ] && { echo "ERROR=DIR_LEFT"; exit 3; }
rm -f "$ROOT/.claude/worktrees/$FEATURE.base"
echo "REMOVED=$WT"
