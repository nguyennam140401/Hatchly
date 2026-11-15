---
name: speckit-wiki-ingest
description: Hook after_implement của Spec Kit (chạy sau speckit-worktree-finish) – sau khi tính năng đã merge vào nhánh gốc (dev), tổng hợp tri thức của tính năng vào docs/wiki theo quy trình Ingest của AGENTS.md. Không tự commit. Gọi tay được (`/speckit-wiki-ingest 009`) khi pull request merge sau.
user-invocable: true
disable-model-invocation: false
---

Trả lời người dùng bằng tiếng Việt. Dùng Bash (POSIX). Schema và quy tắc wiki nằm ở `AGENTS.md` (§3 cấu trúc,
§4 quy trình Ingest) – đọc trước khi ghi. **Không commit, không push.**

## 1. Xác định tính năng và điều kiện chạy

1. `NNN`/`FEATURE`: tham số đầu (mã 3 chữ số) → thư mục `specs/<NNN>-*`; không có tham số → lấy từ
   `git log -1 --grep '^merge(' --format=%s` (dạng `merge(<NNN>): <FEATURE>`); vẫn không có → kết thúc im lặng.
2. `BR` = `git branch --show-current`. Không phải nhánh gốc (`dev`; nhánh bắt đầu bằng `impl/` hoặc đang ở
   worktree – `git rev-parse --git-dir` khác `--git-common-dir`) → **kết thúc im lặng** (tính năng chưa vào `dev`;
   hook chạy sau khi người dùng chọn giữ/bỏ worktree).
3. Tính năng phải đã nằm trong `dev`: `git branch --list "impl/<FEATURE>"` còn thì dùng
   `git merge-base --is-ancestor "impl/<FEATURE>" HEAD`; nhánh đã bị xóa thì cần có commit `merge(<NNN>)` trong
   `git log --grep "^merge(<NNN>)"`. Không thỏa (vd finish chọn "Đẩy PR", PR chưa merge) → dừng và nhắc:
   "Sau khi PR merge, chạy `/speckit-wiki-ingest <NNN>`".
4. `git status --porcelain docs/wiki` có thay đổi dở → dừng, báo người dùng (tránh trộn với việc chưa commit).

## 2. Ingest (AGENTS.md §4)

1. Đọc nguồn thay đổi: `git log --stat` theo `specs/<NNN>-*/`, mã nguồn và tài liệu mà tính năng chạm tới; đọc
   `docs/wiki/index.md` và trang liên quan hiện có.
2. Tạo/sửa `docs/wiki/features/<NNN>-<tên>.md` đủ mục: Mục tiêu · Mã FR/NFR · Trạng thái · Quyết định chính ·
   Chạm tới (bảng, hàng chờ, API, module) · Điểm cần biết khi sửa tiếp · Nguồn; frontmatter đủ, `status: current`
   khi khớp nguồn (`draft` nếu tasks chưa xong), `updated` = ngày hôm nay.
3. Cập nhật trang bị ảnh hưởng: `modules/`, `concepts/`, `glossary.md`, `decisions/index.md`, `open-questions.md`;
   trang có `sources` đổi thì cập nhật `updated`/`status`.
4. Cập nhật `index.md` (mọi trang có mặt, kèm 1 dòng tóm tắt + trạng thái).
5. Thêm một mục cuối `log.md`: `## [YYYY-MM-DD] ingest | <NNN>-<FEATURE>` + gạch đầu dòng trang đã đụng tới.
6. Chạy `pnpm wiki:check`; lỗi → sửa và chạy lại tới khi đạt.

Quy tắc nội dung: nguồn thô là sự thật (mâu thuẫn → sửa wiki, ghi log); mọi khẳng định kèm nguồn; không bí mật,
không số tiền chi phí AI theo hướng hiển thị cho khách; không chép nguyên văn dài.

## 3. Báo cáo

In danh sách trang đã tạo/sửa (`git status --porcelain docs/wiki`) và kết quả `pnpm wiki:check`.
Gợi ý commit riêng: `docs(wiki): ingest <NNN>`. Nếu `dev` được bảo vệ (xem `docs/ci-cd/branching-and-release.md`),
gợi ý commit trên nhánh `docs/wiki-<NNN>` rồi mở pull request. **Không tự commit.**
