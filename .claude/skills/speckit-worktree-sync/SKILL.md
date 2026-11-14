---
name: speckit-worktree-sync
description: Hook before_implement của Spec Kit – chạy sau speckit-worktree-switch, merge nhánh gốc (dev) mới nhất vào worktree impl/<feature> trước khi thi công. Bỏ qua khi implement chạy ở repo chính. Dừng nếu cây làm việc chưa sạch hoặc có xung đột.
user-invocable: true
disable-model-invocation: false
---

Trả lời người dùng bằng tiếng Việt. `SKILL_DIR` là `.claude/skills/speckit-worktree-sync`, tính từ gốc checkout hiện tại.

## Mục đích

Worktree `impl/<feature>` rẽ từ `dev` lúc tạo; trước khi implement cần kéo code mới của `dev` vào để tránh
xung đột lớn lúc `/speckit-worktree-finish`. Dùng **merge** (không rebase) để không viết lại lịch sử.

## Thực hiện

Chạy: `bash "$SKILL_DIR/scripts/sync.sh"` (từ thư mục hiện tại của phiên, tức worktree).

Xử lý theo `STATUS`:

- `SKIP_MAIN` → implement ở repo chính, không in gì, kết thúc hook.
- `UP_TO_DATE` → báo "Worktree đã có code mới nhất của `<BASE>`."
- `MERGED` → báo số commit mới (`NEW_COMMITS`) đã merge từ `<BASE>`. Nếu `LOCK_CHANGED=true` thì chạy
  `pnpm install --frozen-lockfile` trong worktree.
- `DIRTY` → **dừng**, liệt kê dòng `OTHER:`, đề nghị người dùng tự commit hoặc stash rồi chạy lại. Không tự làm hộ.
- `CONFLICT` → **dừng** (merge đã được abort, cây sạch). Liệt kê `CONFLICT_FILE:`, nói rõ ref (`REF`), gợi ý
  người dùng chạy `git merge <REF>` thủ công, giải quyết rồi chạy lại implement. Không để lệnh gốc tiếp tục.

`FETCH=failed` → nhắc một dòng "không fetch được origin, đã dùng `<BASE>` cục bộ", không dừng.

Hook idempotent: chạy lại nhiều lần an toàn. Khi không dừng, lệnh gốc chạy tiếp.
