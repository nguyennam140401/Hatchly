# Nhật ký wiki

Append-only. Định dạng: `## [YYYY-MM-DD] ingest|query|lint | tiêu đề`.

## [2026-11-14] ingest | Khởi tạo wiki, nội dung tính năng 001–009

- Tạo schema AGENTS.md; chép bài mẫu sang docs/llm-wiki-pattern.md
- Tạo features/001–009, modules/ (11), concepts/ (9), decisions/index.md, howto/ (4), glossary, open-questions
- Thêm `pnpm wiki:check` (tooling/check-wiki.mjs)
- Phát hiện lệch tài liệu/mã: MIGRATION_BASE_REF (database.md ghi main, mã dùng origin/dev); ADR-11 còn ghi "Đề xuất" dù 008 đã merge; account thiếu subscriptions/usage_cycles so với architecture.md

## [2026-11-15] ingest | Trang danh sách tính năng và trạng thái

- Thêm concepts/feature-status.md: bảng FR-01…FR-15 và tiến độ spec 001–011 (đếm từ tasks.md)

## [2026-11-16] ingest | 011-ui-architecture-foundation

- Thêm features/011-ui-architecture-foundation.md (`draft`: còn T074, kèm mục "Việc còn lại") và concepts/web-ui.md
- Cập nhật concepts/feature-status.md (011: 84/85, giao diện hiện có, thứ tự làm tiếp), concepts/ci-cd.md (cổng `check:web-rules`, `test:web-e2e`),
  howto/run-tests.md (E2E web), open-questions.md (T074, kiểm thủ công, Figma, verify đỏ có sẵn), index.md
- Lưu ý: wiki chưa ingest 010, 012 và trang 009 vẫn `draft` dù đã merge; không thuộc lần này
