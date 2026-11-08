---
name: speckit-worktree-finish
description: Hook after_implement của Spec Kit – tóm tắt kết quả implement trong worktree impl/<feature>, hỏi người dùng merge --no-ff về nhánh gốc / giữ / bỏ, rồi dọn worktree. Gọi được thủ công từ trong worktree để hoàn tất phần đã giữ lại.
user-invocable: true
disable-model-invocation: false
---

Trả lời người dùng bằng tiếng Việt. Dùng Bash (POSIX). **Không bao giờ merge, xóa nhánh hay xóa
worktree khi chưa có xác nhận của người dùng qua AskUserQuestion.**

## 1. Xác định ngữ cảnh

1. Gọi thủ công có mã tính năng (vd `/speckit-worktree-finish 003`) → chạy
   `bash .claude/skills/speckit-worktree-switch/scripts/resolve.sh 003`; nếu `CUR_IS_WT=false` và
   `WT_EXISTS=true` → `EnterWorktree(path: <WT>)` rồi tiếp tục; `WT_EXISTS=false` → báo không có
   worktree của tính năng đó, dừng.
   Không có mã và `git rev-parse --git-dir` == `git rev-parse --git-common-dir` (không ở worktree):
   chạy từ hook (implement không mã, làm trên nhánh chính) → kết thúc im lặng; gọi thủ công và có
   `.claude/worktrees/*.base` → hỏi muốn hoàn tất worktree nào rồi `EnterWorktree(path)` vào đó.
2. `BR` = `git branch --show-current`; không bắt đầu bằng `impl/` → kết thúc im lặng.
   `FEATURE` = phần sau `impl/`, `NNN` = 3 chữ số đầu.
3. `WT` = `git rev-parse --show-toplevel`; `ROOT` = thư mục cha của `git rev-parse --git-common-dir`
   (đường dẫn tuyệt đối).
4. `BASE` = nội dung `<ROOT>/.claude/worktrees/<FEATURE>.base`. Thiếu file → AskUserQuestion chọn
   nhánh đích trong `git branch --format='%(refname:short)'` (loại `impl/*`).

## 2. Chốt thay đổi trong worktree

- `git status --porcelain` có thay đổi → `git add -A` rồi
  `git commit -m "feat(<NNN>): hoàn tất implement"` (kèm attribution theo system-reminder nếu có).
  Kiểm tra trước không có tệp bí mật (`.env`, khóa) bị đưa vào – `.gitignore` đã chặn, nhưng nếu thấy
  thì dừng và báo.
- Chạy `pnpm verify` trong `<WT>`; ghi lại đạt/lỗi và các bước lỗi.

## 3. Tóm tắt

```bash
git log --oneline "<BASE>..HEAD"
git diff --stat "<BASE>...HEAD" | tail -1
```

Đếm task trong `<feature_directory>/tasks.md`: xong = dòng `- [x]`/`- [X]`, tổng = dòng `- [ ]` + xong.
Kiểm tra `<BASE>` có commit mới sau lúc rẽ nhánh: `git log --oneline HEAD..<BASE>` (có → nhắc khả năng
xung đột).

In bảng: nhánh gốc, nhánh worktree, số commit, tệp thay đổi, task xong/tổng, `pnpm verify`.

## 4. Hỏi người dùng

AskUserQuestion, câu hỏi tự đủ nghĩa (nêu `<BR>` → `<BASE>` và tình trạng verify/task):

- "Merge vào `<BASE>`" – `git merge --no-ff`, rồi xóa worktree và nhánh `<BR>`.
- "Giữ worktree để sửa tiếp" – quay về repo chính, không merge.
- "Bỏ worktree" – xóa worktree và nhánh, **mất** các commit trên `<BR>`.

Nếu verify lỗi hoặc còn task chưa xong: ghi rõ trong câu hỏi và đặt "Giữ worktree" lên đầu kèm
"(Khuyến nghị)". Ngược lại đặt "Merge" lên đầu kèm "(Khuyến nghị)".

## 5a. Merge

1. `ExitWorktree` với `action: "keep"` (worktree vào bằng `path` không bị công cụ xóa).
   Phiên giờ ở `<ROOT>`.
2. Kiểm tra repo chính: `git status --porcelain` phải sạch; nhánh hiện tại phải là `<BASE>` – nếu
   khác, hỏi người dùng có `git switch <BASE>` không. Không sạch → dừng, báo, giữ worktree.
3. ```bash
   git merge --no-ff "impl/<FEATURE>" -m "merge(<NNN>): <FEATURE>"
   ```
   (thêm attribution vào thông điệp nếu system-reminder yêu cầu – dùng `-m` thứ hai.)
4. Xung đột → `git merge --abort`, liệt kê tệp xung đột, báo người dùng worktree vẫn còn ở
   `.claude/worktrees/<FEATURE>`; gợi ý: vào lại worktree, `git merge <BASE>` để giải quyết ở đó, rồi
   chạy lại `/speckit-worktree-finish`. Dừng.
5. Thành công → dọn (script xóa node_modules trước vì `git worktree remove` trên Windows hay lỗi
   "Result too large"; nó từ chối nếu worktree còn thay đổi đã theo dõi chưa commit):
   ```bash
   bash .claude/skills/speckit-worktree-switch/scripts/remove.sh "<ROOT>" "<FEATURE>"
   git branch -d "impl/<FEATURE>"
   ```
   `ERROR=TRACKED_CHANGES` → báo người dùng, không xóa. `ERROR=DIR_LEFT` → báo thư mục còn sót để
   người dùng tự xóa (thường do tệp đang bị chương trình khác mở).
6. In: commit merge (`git log --oneline -1`), nhánh hiện tại, xác nhận worktree đã xóa
   (`git worktree list`).

## 5b. Giữ worktree

`ExitWorktree` với `action: "keep"`. In:
- Worktree: `.claude/worktrees/<FEATURE>`, nhánh `impl/<FEATURE>`.
- Làm tiếp: chạy `/speckit-implement <NNN>` (hook switch tự vào lại worktree) hoặc
  `/speckit-worktree-finish <NNN>` để merge sau.

## 5c. Bỏ worktree

Xác nhận lần 2 bằng AskUserQuestion, liệt kê các commit sẽ mất. Đồng ý →
`ExitWorktree(keep)`, rồi tại `<ROOT>`:

```bash
bash .claude/skills/speckit-worktree-switch/scripts/remove.sh "<ROOT>" "<FEATURE>" --discard
git branch -D "impl/<FEATURE>"
```
