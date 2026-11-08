#!/usr/bin/env bash
# Tạo (hoặc gắn lại) worktree cho một tính năng và chuẩn bị để làm việc được ngay.
# Dùng: create.sh <ROOT> <FEATURE>
#   - Nhánh impl/<FEATURE> chưa có → tạo mới từ HEAD của repo chính.
#   - Nhánh đã có (thư mục worktree bị mất) → gắn lại vào nhánh đó.
set -eu
ROOT=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir | xargs dirname)
FEATURE=$2
WT="$ROOT/.claude/worktrees/$FEATURE"
BR="impl/$FEATURE"
cd "$ROOT"

# Thư mục còn sót (worktree đã gỡ đăng ký nhưng chưa xóa hết) → không tự xóa, báo để người dùng quyết.
if [ -e "$WT" ]; then echo "ERROR=WT_DIR_LEFTOVER"; echo "WT=$WT"; exit 4; fi

if git rev-parse --verify --quiet "refs/heads/$BR" >/dev/null; then
  git worktree add "$WT" "$BR"
else
  git worktree add -b "$BR" "$WT" HEAD
fi

# Tệp bị .gitignore nhưng cần để làm việc: chép nếu có, không ghi đè.
copy() { [ -e "$ROOT/$1" ] && [ ! -e "$WT/$1" ] && { mkdir -p "$(dirname "$WT/$1")"; cp -r "$ROOT/$1" "$WT/$1"; echo "COPIED=$1"; } || true; }
copy CLAUDE.md
copy CLAUDE.local.md
copy TaiLieuDacTa
copy apps/server/.env
for f in "$ROOT"/apps/web/.env*; do
  [ -e "$f" ] || continue
  name=apps/web/$(basename "$f")
  [ "$name" = apps/web/.env.example ] && continue
  copy "$name"
done

# Con trỏ tính năng của worktree trỏ đúng tính năng này (không chép của repo chính,
# vì repo chính có thể đang trỏ tính năng khác).
mkdir -p "$WT/.specify"
printf '{"feature_directory":"specs/%s"}\n' "$FEATURE" > "$WT/.specify/feature.json"

# Ghi nhánh gốc để speckit-worktree-finish biết merge về đâu (giữ nếu đã có).
base_file="$ROOT/.claude/worktrees/$FEATURE.base"
[ -f "$base_file" ] || git branch --show-current > "$base_file"
echo "BASE=$(cat "$base_file")"

if [ -f "$WT/package.json" ]; then
  if (cd "$WT" && pnpm install --frozen-lockfile >"$WT/.pnpm-install.log" 2>&1); then
    echo "INSTALL=ok"; rm -f "$WT/.pnpm-install.log"
  else
    echo "INSTALL=failed"; tail -15 "$WT/.pnpm-install.log"
  fi
fi
echo "WT=$WT"
