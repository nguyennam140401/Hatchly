---
name: speckit-worktree-start
description: Hook before_implement của Spec Kit – tạo git worktree trên nhánh impl/<feature> từ HEAD hiện tại và chuyển phiên làm việc sang đó trước khi /speckit-implement chạy. Chỉ gọi từ hook hoặc khi người dùng yêu cầu rõ.
user-invocable: true
disable-model-invocation: false
---

Mục tiêu: `/speckit-implement` chạy trong một worktree riêng, nhánh hiện tại không bị đụng tới cho tới
khi người dùng xác nhận merge (xem skill `speckit-worktree-finish`). Trả lời người dùng bằng tiếng Việt.
Dùng Bash (POSIX) cho các lệnh dưới đây; `<ROOT>` = thư mục gốc repo chính.

## 1. Kiểm tra điều kiện

1. `git rev-parse --is-inside-work-tree` thất bại → báo "không phải repo git, bỏ qua worktree" và
   kết thúc hook (implement chạy bình thường).
2. Nếu `git rev-parse --git-dir` khác `git rev-parse --git-common-dir` → phiên **đã ở trong một
   worktree** (vd chạy lại implement để làm tiếp) → báo "đang ở worktree `<nhánh>`, dùng tiếp" và kết
   thúc hook. KHÔNG tạo worktree lồng nhau.
3. Đọc `.specify/feature.json` → `feature_directory` (vd `specs/002-db-layer-tenant-rls`).
   `FEATURE` = tên thư mục cuối (vd `002-db-layer-tenant-rls`), `NNN` = 3 chữ số đầu.
   Không có file → chạy
   `powershell -NoProfile -ExecutionPolicy Bypass -File .specify/scripts/powershell/check-prerequisites.ps1 -Json`
   để lấy `FEATURE_DIR`; vẫn không có → dừng, báo người dùng.
4. `BASE` = `git branch --show-current`. Rỗng (detached HEAD) → dừng, yêu cầu checkout một nhánh.
5. `git rev-parse --verify HEAD` thất bại (repo chưa có commit) → dừng, yêu cầu commit đầu tiên.

## 2. Thay đổi chưa commit

`git status --porcelain --untracked-files=all`:

- Sạch → sang bước 3.
- **Chỉ** có đường dẫn dưới `<feature_directory>/` → dùng AskUserQuestion:
  "Tài liệu của `<FEATURE>` chưa commit nên sẽ không có trong worktree. Commit ngay trên `<BASE>`?"
  - "Commit tài liệu (Khuyến nghị)" → `git add -- <feature_directory>` rồi
    `git commit -m "docs(<NNN>): đặc tả, kế hoạch, danh sách việc"` (kèm dòng attribution theo
    system-reminder nếu có).
  - "Dừng" → kết thúc hook, báo implement chưa chạy.
- Có thay đổi ngoài thư mục feature → DỪNG: liệt kê các tệp, đề nghị người dùng tự commit/stash rồi
  chạy lại `/speckit-implement`. Không tự commit, không stash hộ.

## 3. Worktree đã tồn tại?

`WT=<ROOT>/.claude/worktrees/<FEATURE>`, `BR=impl/<FEATURE>`.

- Nếu `git worktree list --porcelain` có `WT` hoặc `git rev-parse --verify --quiet refs/heads/<BR>`
  thành công → AskUserQuestion:
  - "Vào lại worktree cũ (Khuyến nghị)" – làm tiếp phần dở dang → nếu thư mục còn thì sang bước 6,
    nếu chỉ còn nhánh thì `git worktree add "<WT>" <BR>` rồi sang bước 5.
  - "Xóa và tạo mới từ `<BASE>`" – cảnh báo mất các commit chưa merge
    (`git log --oneline <BASE>..<BR>`); xác nhận rồi
    `git worktree remove --force "<WT>"` (nếu có), `git branch -D <BR>`, sang bước 4.
  - "Dừng".

## 4. Tạo worktree

```bash
git worktree add -b "impl/<FEATURE>" "<ROOT>/.claude/worktrees/<FEATURE>" HEAD
```

## 5. Chuẩn bị worktree

Các tệp bị `.gitignore` nhưng cần cho implement → chép từ `<ROOT>` sang `<WT>` (chỉ khi tồn tại,
không ghi đè nếu đích đã có):

- `CLAUDE.md`, `CLAUDE.local.md` (hướng dẫn dự án cho phiên trong worktree)
- `TaiLieuDacTa/` (tài liệu đặc tả, chỉ đọc)
- `.specify/feature.json`
- `apps/server/.env`, `apps/web/.env*` (trừ `.env.example` đã được theo dõi)

Rồi cài phụ thuộc (store pnpm dùng chung nên nhanh):

```bash
cd "<WT>" && pnpm install --frozen-lockfile
```

Lỗi cài → báo người dùng kèm vài dòng cuối nhật ký, hỏi tiếp tục hay dừng.

Ghi nhánh gốc để bước finish biết merge vào đâu:

```bash
echo "<BASE>" > "<ROOT>/.claude/worktrees/<FEATURE>.base"
```

## 6. Chuyển phiên sang worktree

Gọi công cụ `EnterWorktree` với `path` = `<WT>` (nạp lược đồ qua ToolSearch `select:EnterWorktree`
nếu cần). Không dùng `cd` thay thế – `cd` ra ngoài thư mục làm việc không được giữ giữa các lệnh.

In thông báo ngắn:

```
Đã chuyển sang worktree
- Nhánh gốc  : <BASE>
- Nhánh mới  : impl/<FEATURE>
- Thư mục    : .claude/worktrees/<FEATURE>
Mọi thay đổi của implement nằm trên nhánh mới; chỉ merge về <BASE> khi bạn xác nhận.
Lưu ý: đừng chạy docker compose ở cả repo chính và worktree cùng lúc (trùng cổng 3000/3001/8080).
```

Sau đó trả quyền cho `/speckit-implement` chạy tiếp phần Outline **trong worktree** (đọc lại
`feature_directory` theo đường dẫn của worktree).
