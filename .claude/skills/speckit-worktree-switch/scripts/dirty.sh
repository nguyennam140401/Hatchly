#!/usr/bin/env bash
# Phân loại thay đổi chưa commit ở repo chính trước khi tạo worktree.
# Dùng: dirty.sh <ROOT> <FEATURE>
# In: STATUS=clean|feature_only|blocked, rồi các dòng FEATURE:/OTHER_SPEC:/OTHER: <đường dẫn>.
set -u
ROOT=$1; FEATURE=$2

feature=(); other_spec=(); other=()
while IFS= read -r line; do
  [ -z "$line" ] && continue
  path=${line:3}
  path=${path#\"}; path=${path%\"}
  case "$path" in
    "specs/$FEATURE"/*) feature+=("$path") ;;
    specs/*) other_spec+=("$path") ;;
    *) other+=("$path") ;;
  esac
done < <(git -C "$ROOT" status --porcelain --untracked-files=all)

if [ ${#other[@]} -gt 0 ]; then echo "STATUS=blocked"
elif [ ${#feature[@]} -gt 0 ]; then echo "STATUS=feature_only"
else echo "STATUS=clean"; fi

for p in "${feature[@]+"${feature[@]}"}"; do echo "FEATURE: $p"; done
for p in "${other_spec[@]+"${other_spec[@]}"}"; do echo "OTHER_SPEC: $p"; done
for p in "${other[@]+"${other[@]}"}"; do echo "OTHER: $p"; done
