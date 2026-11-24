---
name: pm-init
description: Kiểm tra cài đặt bộ PM cho dự án này - xác nhận speckit và hook worktree có sẵn, .gitignore theo dõi agent/hook, bảng sở hữu khớp thư mục thật, và chạy thử ba điểm chưa kiểm chứng (hook có nhận agent_type, agent con vào đúng thư mục worktree, PM gọi được agent con). Chạy một lần sau khi cài và sau khi nâng cấp speckit hoặc Claude Code.
---

Thực hiện lần lượt, báo mỗi mục một dòng (đạt, lỗi, cần xem), bằng tiếng Việt. Không sửa tệp nếu người dùng chưa đồng ý; chỉ đề xuất.

## 1. speckit và hook của dự án
- Có `.specify/extensions.yml` và các skill `speckit-worktree-switch`, `speckit-worktree-sync`, `speckit-worktree-finish`, `speckit-wiki-ingest`, `constitution-review`, `speckit-specify|clarify|plan|tasks|analyze|converge|implement` trong `.claude/skills/` không?
- `.specify/memory/constitution.md` và `.specify/memory/architecture.md` có không?

## 2. Theo dõi trong git
- `.gitignore` phải có ngoại lệ cho `.claude/agents/`, `.claude/hooks/`, `.claude/settings.json` (nếu không, worktree mới sẽ không có agent và hook), và ignore `.specify/pm/state/`. Chạy `git check-ignore -v .claude/agents/pm.md .claude/hooks/lib.mjs .claude/settings.json`: tệp nào bị ignore là lỗi. Worktree cũ chỉ có sau khi đồng bộ nhánh `dev`.

## 3. Bảng sở hữu khớp thư mục thật
- Với mỗi đường dẫn gốc trong `.specify/ownership.json` (phần trước ký tự `*` đầu tiên), kiểm tra thư mục có tồn tại. Báo thư mục không có, và các thư mục cấp 1 hoặc 2 của `apps/`, `packages/`, `tooling/`, `infra/` chưa thuộc agent nào.
- Báo các cặp phạm vi ghi giao nhau giữa hai agent (trừ `qa`, vốn thắng xung đột theo thiết kế).

## 4. Chạy thử ba điểm chưa kiểm chứng
a. **PM gọi được agent con:** giao `reviewer` một việc chỉ đọc (liệt kê 3 tệp đầu của `specs/`), nếu lỗi cú pháp công cụ thì đổi `Agent(...)` thành `Task(...)` trong `tools` của `.claude/agents/pm.md`.
b. **Hook nhận `agent_type`:** giao `analyst` thử ghi `<ROOT>/apps/server/src/_pm_probe.txt` (ngoài phạm vi). Phải bị chặn bởi `ownership-guard`. Nếu ghi được, hãy xóa tệp thử rồi báo: bản Claude Code chưa cấp `agent_type` cho hook, cần cập nhật.
c. **Agent con làm việc đúng checkout:** sau khi `speckit-worktree-switch <NNN>` (nếu có worktree), giao `reviewer` chạy `git rev-parse --show-toplevel` và đối chiếu với `ROOT`. Khác nhau nghĩa là agent con không kế thừa thư mục worktree: khi đó mọi lời giao việc phải dùng đường dẫn tuyệt đối từ `ROOT` (PM đã làm vậy) và dev phải chạy lệnh bằng `pnpm -C <ROOT>` hoặc `git -C <ROOT>`.

## 5. Điền thông tin còn thiếu
- Nếu `.specify/project-context.md` còn dòng chưa điền hoặc lệch thực tế (đối chiếu `package.json` gốc và `apps/*/package.json`), cập nhật và giữ dưới 60 dòng.
- `CLAUDE.md` có đoạn "Project state" nói "chưa có mã nguồn, chưa là repo git" thì đề xuất người dùng sửa (đoạn này sai và nạp vào mọi agent).

## 6. Báo cáo
Bảng ngắn: mục, kết quả, việc người dùng cần làm. Không in lại toàn bộ tệp.
