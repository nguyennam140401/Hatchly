# Nhật ký wiki

Append-only. Định dạng: `## [YYYY-MM-DD] ingest|query|lint | tiêu đề`.

## [2026-11-14] ingest | Khởi tạo wiki, nội dung tính năng 001–009

- Tạo schema AGENTS.md; chép bài mẫu sang docs/llm-wiki-pattern.md
- Tạo features/001–009, modules/ (11), concepts/ (9), decisions/index.md, howto/ (4), glossary, open-questions
- Thêm `pnpm wiki:check` (tooling/check-wiki.mjs)
- Phát hiện lệch tài liệu/mã: MIGRATION_BASE_REF (database.md ghi main, mã dùng origin/dev); ADR-11 còn ghi "Đề xuất" dù 008 đã merge; account thiếu subscriptions/usage_cycles so với architecture.md
