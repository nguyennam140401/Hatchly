---
name: speckit-worktree-switch
description: Hook before_* dùng chung cho mọi lệnh Spec Kit (specify, clarify, plan, tasks, analyze, checklist, converge, implement). Khi lệnh có tham số mã tính năng ở đầu (vd `/speckit-plan 003 …`), skill này vào worktree `impl/<NNN-…>` của tính năng đó, hoặc tạo worktree nếu chưa có. Khi lệnh không có mã, hoặc là `/speckit-specify`, skill đưa phiên về repo chính. Chạy tự động qua `.specify/extensions.yml`; có thể gọi tay khi người dùng muốn chuyển sang worktree của một tính năng.
user-invocable: true
disable-model-invocation: false
---

Trả lời người dùng bằng tiếng Việt. Lệnh shell chạy bằng Bash (POSIX). `SKILL_DIR` là thư mục chứa
tệp này: `.claude/skills/speckit-worktree-switch`, tính từ gốc checkout hiện tại.

## Vì sao có skill này

Các lệnh Spec Kit xác định tính năng đang làm bằng con trỏ `.specify/feature.json`, và mỗi checkout chỉ
có một con trỏ. Nếu nhiều phiên cùng làm việc trên một checkout, các phiên sẽ đè con trỏ của nhau. Lỗi
này không báo gì: phiên này có thể ghi `plan.md` vào thư mục của tính năng khác. Cách xử lý là cho mỗi
tính năng một worktree riêng, mỗi worktree có con trỏ riêng. Mã tính năng trong tham số cho biết phải
vào worktree nào.

Có hai quy tắc người dùng đã chốt:

- **Không có mã → làm ở repo chính** với `feature.json` của repo chính. Quy tắc này áp dụng cả cho
  `/speckit-implement`: implement không có mã chạy ở nhánh chính, không có bước merge ở cuối.
- **`/speckit-specify` luôn chạy ở repo chính.** Script đánh số NNN quét `specs/` của checkout hiện
  tại. Nếu mọi tính năng mới đều được tạo ở một nơi thì số không bao giờ bị trùng.

## 1. Lấy mã tính năng

Lệnh gốc là lệnh speckit vừa gọi hook này. Đọc `$ARGUMENTS` mà người dùng truyền cho lệnh gốc; nó có
trong hội thoại ngay trước đó.

- Lệnh gốc là `speckit-specify` → không có mã. Tham số của specify là mô tả tính năng, không phải mã.
- Lệnh khác: token đầu tiên khớp `^\d{3}$` hoặc `^\d{3}-[a-z0-9-]+$` thì token đó là mã `TOKEN`.
  Phần còn lại là `REST`, tức ngữ cảnh dành cho lệnh gốc.
- Không khớp thì không có mã. Một chuỗi như "003 bị lỗi gì đó" vẫn có mã; một chuỗi như "thêm 3 bảng"
  thì không.

Chạy:

```bash
bash "$SKILL_DIR/scripts/resolve.sh" [TOKEN]
```

Script in ra các giá trị: `ROOT`, `CUR_TOP`, `IN_WT`, `CUR_BRANCH`, `ROOT_BRANCH`. Khi có mã, script in
thêm `FEATURE`, `NNN`, `FEATURE_DIR`, `WT`, `BR`, `WT_EXISTS`, `BR_EXISTS`, `CUR_IS_WT`.

Xử lý khi script báo lỗi:

- `ERROR=NOT_GIT` → báo "không phải repo git, bỏ qua worktree" rồi kết thúc hook.
- `ERROR=FEATURE_NOT_FOUND` → dừng. Báo người dùng rằng không có `specs/<TOKEN>-*` trong repo chính và
  gợi ý chạy `/speckit-specify` trước. Không để lệnh gốc tiếp tục, vì nó sẽ làm nhầm tính năng.
- `ERROR=AMBIGUOUS` → dùng AskUserQuestion để người dùng chọn một trong các dòng `CANDIDATE`, rồi chạy
  lại script với tên đầy đủ.

## 2. Không có mã → về repo chính

- `IN_WT=true` → gọi `ExitWorktree` với `action: "keep"`. Nếu cần, nạp lược đồ trước bằng ToolSearch
  `select:ExitWorktree`. Worktree vẫn được giữ nguyên trên đĩa. Báo:
  "Đã về repo chính (nhánh `<ROOT_BRANCH>`), dùng `.specify/feature.json` của repo chính."
- `IN_WT=false` → không làm gì và không in gì.

Kết thúc hook. Lệnh gốc chạy tiếp như bình thường.

## 3. Có mã → vào worktree của tính năng

Chọn đúng một nhánh xử lý theo thứ tự sau:

1. **`CUR_IS_WT=true`**: phiên đã ở đúng worktree. Chỉ in thông báo (bước 4).
2. **`WT_EXISTS=true`**: gọi `EnterWorktree` với `path: <WT>`; nạp lược đồ bằng ToolSearch
   `select:EnterWorktree` nếu cần. Cách này dùng được cả khi phiên đang ở một worktree khác: worktree cũ
   vẫn nằm nguyên trên đĩa, kể cả thay đổi chưa commit của nó, nên không cần commit hay Exit trước.
3. **`WT_EXISTS=false`, `BR_EXISTS=true`**: thư mục worktree đã mất nhưng nhánh vẫn còn, nên gắn lại.
   Chạy `bash "$SKILL_DIR/scripts/create.sh" "<ROOT>" "<FEATURE>"`, rồi `EnterWorktree(path: <WT>)`.
4. **Chưa có gì**: tạo worktree mới.
   1. Chạy `bash "$SKILL_DIR/scripts/dirty.sh" "<ROOT>" "<FEATURE>"`. Worktree được tạo từ commit HEAD,
      nên phần chưa commit sẽ không có trong worktree.
      - `STATUS=clean` → đi tiếp.
      - `STATUS=feature_only` → dùng AskUserQuestion: "Tài liệu của `<FEATURE>` chưa commit nên sẽ không
        có trong worktree. Commit ngay trên `<ROOT_BRANCH>`?" Hai lựa chọn:
        - "Commit tài liệu (Khuyến nghị)" → chạy
          `git -C "<ROOT>" add -- "specs/<FEATURE>"`, rồi
          `git -C "<ROOT>" commit -m "docs(<NNN>): đặc tả, kế hoạch, danh sách việc"`. Thêm các dòng
          attribution theo system-reminder nếu có, mỗi dòng bằng một `-m` riêng.
        - "Dừng" → báo rằng lệnh gốc chưa chạy, rồi kết thúc.
      - `STATUS=blocked` → dừng. Liệt kê các dòng `OTHER:` và đề nghị người dùng tự commit hoặc stash.
        Không commit hay stash thay người dùng, vì đó có thể là việc dở dang mà người dùng chưa muốn
        đóng gói.
      - Các dòng `OTHER_SPEC:` là spec của tính năng khác đang được viết ở repo chính. Chúng không ảnh
        hưởng worktree này, nên chỉ nhắc một dòng rồi bỏ qua.
   2. Chạy `bash "$SKILL_DIR/scripts/create.sh" "<ROOT>" "<FEATURE>"`. Script làm các việc sau:
      - tạo nhánh `impl/<FEATURE>` từ HEAD của repo chính;
      - chép các tệp bị gitignore nhưng cần dùng: `CLAUDE.md`, `TaiLieuDacTa/`, `.env`;
      - ghi `feature.json` của worktree trỏ đúng tính năng này;
      - ghi tệp `.base` lưu nhánh gốc;
      - chạy `pnpm install`.

      Nếu `INSTALL=failed` thì in các dòng log cuối, rồi hỏi người dùng muốn tiếp tục hay dừng.
      Nếu `ERROR=WT_DIR_LEFTOVER` thì thư mục worktree cũ còn sót lại trên đĩa nhưng git không còn đăng
      ký nó, thường là do lần xóa trước chưa xong. Không tự xóa. Hỏi người dùng có muốn xóa thư mục đó
      không. Nếu đồng ý, chạy `remove.sh "<ROOT>" "<FEATURE>" --discard`, rồi chạy lại `create.sh`.
   3. `EnterWorktree(path: <WT>)`.

   Phiên đang ở một worktree khác vẫn chạy được bước này, vì mọi lệnh đều trỏ `-C <ROOT>`.

Không dùng `cd` thay cho `EnterWorktree`. Lệnh `cd` ra ngoài thư mục làm việc không được giữ giữa các
lệnh, nên lệnh gốc sẽ lại chạy ở chỗ cũ.

## 4. Thông báo rồi trả quyền cho lệnh gốc

```
Đang làm trong worktree của <FEATURE>
- Nhánh gốc : <nội dung <ROOT>/.claude/worktrees/<FEATURE>.base>
- Nhánh     : impl/<FEATURE>
- Thư mục   : .claude/worktrees/<FEATURE>
- Ngữ cảnh cho lệnh: <REST hoặc "(không có)">
Tài liệu và mã nằm trên nhánh impl/…; chỉ về nhánh gốc khi bạn xác nhận merge sau implement.
Lưu ý: đừng chạy docker compose ở hai checkout cùng lúc (trùng cổng 3000/3001/8080).
```

Sau đó lệnh gốc chạy tiếp phần Outline của nó, **trong worktree**:

- Script của Spec Kit chạy từ thư mục hiện tại, nên tự đọc `feature.json` của worktree.
- Lệnh gốc coi `REST` là tham số người dùng và bỏ qua token mã. Token mã chỉ dùng để chọn tính năng.
