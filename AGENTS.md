# AGENTS.md – Schema wiki tra cứu cho agent

Tệp này là **schema** của wiki dự án (mẫu gốc: `docs/llm-wiki-pattern.md`). Nó nói agent cách tìm, đọc,
ghi và giữ cho wiki `docs/wiki/` luôn đúng. Quy tắc dự án (ngôn ngữ, ngăn xếp, gotcha) ở `CLAUDE.md`;
quy tắc bắt buộc ở `.specify/memory/constitution.md` (thắng mọi thứ khác). Không chép lại hai nơi đó vào wiki.

## 1. Ba lớp

| Lớp       | Nằm ở                                                                                                                                                                                                        | Quyền của agent                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Nguồn thô | `specs/<NNN-…>/` (spec, plan, research, data-model, contracts, quickstart, tasks, checklists), `TaiLieuDacTa/`, `.specify/memory/`, `docs/adr/`, `docs/ci-cd/`, `apps/server/docs/`, `infra/docs/`, mã nguồn | **Chỉ đọc** khi chạy quy trình wiki         |
| Wiki      | `docs/wiki/`                                                                                                                                                                                                 | Agent sở hữu: tạo/sửa tự do theo schema này |
| Schema    | `AGENTS.md`                                                                                                                                                                                                  | Chỉ sửa khi người dùng đồng ý               |

Nguồn thô là sự thật; wiki là bản tổng hợp có link về nguồn. Mâu thuẫn → tin nguồn, sửa wiki, ghi `log.md`.

## 2. Tra cứu: câu hỏi → đọc đâu

Luôn bắt đầu từ `docs/wiki/index.md`. Chỉ xuống nguồn thô khi wiki thiếu, `status: stale`, hoặc cần chi tiết
từng dòng.

| Câu hỏi về…                                                                               | Wiki                          | Nguồn thô                                                                          |
| ----------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| Tính năng NNN làm gì, trạng thái                                                          | `features/NNN-*.md`           | `specs/NNN-*/spec.md`, `tasks.md`                                                  |
| Module sở hữu gì, gọi được ai                                                             | `modules/<tên>.md`            | `apps/server/src/modules/modules.manifest.json`, `.specify/memory/architecture.md` |
| Cách hoạt động xuyên module (RLS, đăng bài, ngân sách AI, hàng chờ, auth, CI/CD, hạ tầng) | `concepts/*.md`               | `apps/server/docs/*.md`, `docs/ci-cd/`, `infra/docs/`                              |
| Quyết định kiến trúc                                                                      | `decisions/index.md`          | `TaiLieuDacTa/ADR_*.md`, `docs/adr/`                                               |
| Tên VN ↔ tên mã nguồn                                                                     | `glossary.md`                 | `architecture.md` mục 11                                                           |
| Làm việc X thế nào (lệnh, quy trình)                                                      | `howto/*.md`                  | `specs/*/quickstart.md`, `README.md`, docs vận hành                                |
| Việc còn mở, giả định chưa kiểm chứng                                                     | `open-questions.md`           | `architecture.md` mục 12                                                           |
| Yêu cầu gốc (FR/NFR)                                                                      | trang feature trích mã FR/NFR | `TaiLieuDacTa/Dac_ta_yeu_cau_*.md`                                                 |

## 3. Cấu trúc `docs/wiki/`

```
index.md  log.md  glossary.md  open-questions.md
features/NNN-<tên>.md   modules/<module>.md   concepts/<chủ-đề>.md
decisions/index.md      howto/<tác-vụ>.md
```

- Tên tệp: tiếng Anh, `kebab-case`; trang tính năng dùng đúng tên thư mục trong `specs/`.
- Nội dung: tiếng Việt; định danh (bảng, cột, hàm, hàng chờ) giữ tên mã nguồn tiếng Anh.
- **Frontmatter bắt buộc** mọi trang (trừ `index.md`, `log.md`):

```yaml
---
type: feature | module | concept | decision | howto | glossary | open-questions
title: <tiêu đề ngắn>
sources: [đường/dẫn/nguồn.md, ...] # tệp thật, tồn tại
updated: YYYY-MM-DD
status: draft | current | stale
related: [modules/queue.md, ...] # đường dẫn tương đối trong docs/wiki
---
```

- `status`: `draft` = nguồn chưa đầy đủ (vd chỉ có spec); `current` = khớp nguồn; `stale` = nguồn đổi sau `updated`.
- Liên kết nội bộ dùng đường dẫn tương đối Markdown `[text](../modules/queue.md)`.
- Mọi khẳng định kỹ thuật kèm nguồn (`path` hoặc `path:dòng`). Tóm tắt, không chép nguyên văn dài.
- Trang tính năng có các mục: Mục tiêu · Mã FR/NFR · Trạng thái · Quyết định chính · Chạm tới (bảng, hàng
  chờ, API, module) · Điểm cần biết khi sửa tiếp · Nguồn.
- Không đưa bí mật/khóa/dữ liệu cá nhân; không ghi số tiền chi phí AI theo hướng hiển thị cho khách.

## 4. Quy trình

**Ingest** (sau khi một tính năng merge vào `dev`, hoặc khi nguồn đổi đáng kể):

1. Đọc nguồn thay đổi (`git log --stat` theo đường dẫn nguồn).
2. Tạo/sửa trang `features/NNN-*.md`.
3. Cập nhật các trang bị ảnh hưởng: `modules/`, `concepts/`, `glossary.md`, `decisions/index.md`,
   `open-questions.md` (một tính năng thường chạm 5–15 trang).
4. Cập nhật `index.md` (mọi trang phải có mặt, kèm 1 dòng tóm tắt + trạng thái).
5. Thêm một mục cuối `log.md`.
6. Chạy `pnpm wiki:check`.

**Query**: đọc `index.md` → trang liên quan → (nếu cần) nguồn thô. Câu trả lời có giá trị dùng lại được
(so sánh, phân tích) thì lưu thành trang `concepts/` hoặc `howto/` và ghi log `query`.

**Lint** (trước release hoặc khi được yêu cầu): trang `stale` (nguồn mới hơn `updated` theo `git log`),
mâu thuẫn giữa trang, trang mồ côi / link gãy, khái niệm nhắc nhiều lần chưa có trang, đối chiếu hiến pháp.
Ghi kết quả vào `log.md` (`lint`) và việc cần làm vào `open-questions.md`.

**Định dạng log** (append-only, một mục một khối): `## [YYYY-MM-DD] ingest|query|lint | tiêu đề`, theo sau là
các gạch đầu dòng ngắn liệt kê trang đã đụng tới. Xem 5 mục gần nhất: `grep "^## \[" docs/wiki/log.md | tail -5`.

## 5. Worktree và Spec Kit

- Chỉ ingest/sửa wiki ở nhánh gốc `dev` sau khi tính năng merge, để các worktree song song
  (`.claude/worktrees/<NNN-…>`) không xung đột ở `index.md`/`log.md`.
- Tính năng chưa merge: wiki ghi `status: draft`; ghi chú chờ ingest để trong `specs/<NNN>/` nếu cần.
- **Hook tự động**: `after_implement` chạy `speckit-wiki-ingest` ngay sau `speckit-worktree-finish`
  (`.specify/extensions.yml`). Chỉ ghi wiki khi tính năng đã merge vào `dev`; nếu chưa (giữ worktree, PR chưa
  merge) thì bỏ qua – chạy tay `/speckit-wiki-ingest <NNN>` sau khi merge. Hook **không tự commit**; người dùng
  review và commit riêng (`docs(wiki): ingest <NNN>`).
- `/speckit-plan` đọc `index.md` + `architecture.md` trước; wiki không thay thế mục "Kiểm tra hiến pháp".

## 6. Câu hỏi gợi mở – trả lời dần để hoàn thiện schema

1. ~~**Kích hoạt ingest**~~ → Đã chốt: hook `after_implement` riêng (`speckit-wiki-ingest`) chạy sau finish; gọi
   tay được khi PR merge sau.
2. ~~**Commit**~~ → Đã chốt: commit riêng sau merge, hook không tự commit.
3. **`TaiLieuDacTa/`**: tóm tắt từng tài liệu gốc thành trang wiki, hay chỉ trỏ link trong `index.md`?
4. **`howto/`**: chỉ trỏ tới `docs/ci-cd`, `infra/docs` hay chép bước chính (rủi ro lệch nguồn)?
5. **Ngưỡng `stale`**: theo ngày, hay theo `git log` của các `sources` (đề xuất: theo `git log`)?
6. **Tìm kiếm**: khi wiki > ~100 trang có cần script grep/`qmd` không?
7. **Ngôn ngữ**: có trang nào cần bản tiếng Anh (cho người/agent bên ngoài)?
8. **Phiên song song**: nhiều agent cùng sửa wiki thì dùng quy tắc nào (vd chỉ một phiên ingest tại một
   thời điểm, khóa bằng mục `log.md`)?
9. **Phạm vi mã nguồn**: wiki có liệt kê API/hàm công khai theo module (tự sinh từ code) hay chỉ mô tả
   khái niệm?
10. **Chủ sở hữu**: ai duyệt thay đổi `AGENTS.md` và nội dung wiki trước khi merge (chỉ bạn, hay qua review)?
