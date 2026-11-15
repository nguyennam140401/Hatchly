# Nhật ký wiki

Append-only. Định dạng: `## [YYYY-MM-DD] ingest|query|lint | tiêu đề`.

## [2026-11-14] ingest | Khởi tạo wiki, nội dung tính năng 001–009

- Tạo schema AGENTS.md; chép bài mẫu sang docs/llm-wiki-pattern.md
- Tạo features/001–009, modules/ (11), concepts/ (9), decisions/index.md, howto/ (4), glossary, open-questions
- Thêm `pnpm wiki:check` (tooling/check-wiki.mjs)
- Phát hiện lệch tài liệu/mã: MIGRATION_BASE_REF (database.md ghi main, mã dùng origin/dev); ADR-11 còn ghi "Đề xuất" dù 008 đã merge; account thiếu subscriptions/usage_cycles so với architecture.md

## [2026-11-15] ingest | Trang danh sách tính năng và trạng thái

- Thêm concepts/feature-status.md: bảng FR-01…FR-15 và tiến độ spec 001–011 (đếm từ tasks.md)
