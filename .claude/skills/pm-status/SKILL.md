---
name: pm-status
description: Xem nhanh và khôi phục tiến độ - liệt kê mọi tính năng đang làm (kể cả trong worktree), giai đoạn, câu hỏi mở và bước tiếp theo. Dùng sau khi mở phiên mới hoặc khi người dùng hỏi "đang tới đâu rồi".
---

1. Lấy `MAIN_ROOT` là dòng `worktree` đầu của `git worktree list --porcelain` (Bash). Đọc các tệp `<MAIN_ROOT>/.specify/pm/state/*.md`, chỉ các mục: Loại, Giai đoạn, Câu hỏi đang mở, Cổng, Đang chạy và 3 dòng cuối Nhật ký bàn giao.
2. Với mỗi tính năng, kiểm tra worktree tương ứng có trong danh sách `git worktree list` không (`.claude/worktrees/<NNN-...>`), và `git -C <worktree> status --short` có thay đổi chưa commit không.
3. In bảng: Tính năng | Loại | Giai đoạn | Worktree (có/không, bẩn/sạch) | Cổng còn thiếu | Bước tiếp theo.
4. Nếu có mục "Đang chạy" mà không còn agent nào chạy (phiên bị ngắt), nói rõ và đề xuất giao lại nhiệm vụ đó.
5. Không đọc `spec.md`, `plan.md`, `tasks.md` trừ khi người dùng hỏi chi tiết một tính năng. Tra `docs/wiki/index.md` cho tính năng đã hoàn tất.
