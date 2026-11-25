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

## [2026-11-16] ingest | 012-manual-compose-approval-calendar

- Thêm features/012-manual-compose-approval-calendar.md (`draft`: 91/95, kèm banner việc chưa làm T059, T066, T093, T094)
- Cập nhật concepts/feature-status.md, modules/content.md, modules/approval.md, modules/publishing.md, index.md
- open-questions.md đã có POC-2 (012) và cổng gói/media từ lúc implement

## [2026-11-18] ingest | 014-media-library-basic

- Thêm features/014-media-library-basic.md (`draft`: 92/94, kèm banner việc chưa làm T090, T093)
- Viết lại modules/media.md (`current`: 3 bảng, 4 loại việc, `MediaPublicApi`, `MediaUsageProvider`); cập nhật modules/content.md và modules/publishing.md (nối `MEDIA_DESCRIBER`, `MediaUsageRegistrar`, `getPublishableMedia` thật)
- Cập nhật concepts/feature-status.md (FR-03 một phần, dòng 014, màn Thư viện), open-questions.md (đóng phần media của 012/013, thêm 014-T090/T093/FR-023/gói/trùng-format/verify-đỏ), glossary.md, index.md
- Ghi chú: wiki chưa ingest 010 và 013; trang 009, 011, 012 vẫn `draft`

## [2026-11-24] ingest | 012-manual-compose-approval-calendar

- Sửa features/012-manual-compose-approval-calendar.md (`draft` → `current`: 95/95, T059 huy hiệu số bài chờ, T066 tab Lịch sử, dọn lỗi có sẵn; ghi G, H chưa chạy tay)
- Cập nhật concepts/feature-status.md (dòng 012, mục việc còn lại) và index.md
- Ghi chú: mock e2e dùng chung ở `apps/web/e2e/helpers.ts`; `ownership.json` cấp `docs/wiki/**` cho pm để chạy ingest

## [2026-11-24] ingest | 015-real-ai-gateway

- Thêm features/015-real-ai-gateway.md (`draft`: 97/101, banner điều kiện ngoài T049a, T073a; quyết định chính, bảng chạm tới, điều kiện trước production)
- Viết lại modules/ai_gateway.md (`draft` → `current`: bảng thật, việc nền, API công khai, mã lỗi) và concepts/ai-budget.md (`draft` → `current`: hiện thực thật thay vì bản giả)
- Cập nhật concepts/feature-status.md (FR-11/FR-12, dòng 015, thứ tự làm tiếp), open-questions.md (015-POC-1/4, 015-hợp-đồng, 015-nguồn-ngành, 015-media, 015-bề-mặt-khách, 015-vận-hành) và index.md
- Ghi chú: merge `dev` `ac19fc1` ngày 2026-11-24, nhánh `impl/015-real-ai-gateway` và worktree được giữ; `pnpm verify` sau khi gộp `dev` đạt 15/18 (web e2e chập chờn, chạy lại riêng 51/51; infra bỏ qua); các trang 009, 011, 013, 014 vẫn `draft`

## [2026-11-25] ingest | 013-publish-five-steps

- Thêm features/013-publish-five-steps.md (`draft`: 91/92, banner còn T085 – chưa kiểm chứng với Meta thật; quyết định chính, bảng chạm tới, điểm cần biết khi sửa tiếp)
- Viết lại modules/publishing.md (bảng thật, giao diện công khai và điểm cuối HTTP, thay mô tả "chưa có bảng nào"); cập nhật `updated` của concepts/publish-idempotency.md
- Cập nhật concepts/feature-status.md (dòng 013) và index.md
- Ghi chú: sửa sau converge T088 ("Đăng lại" hoàn tác khi `enqueue` trả `exists`); hỗ trợ gọi API khách hàng nhận 401 (AS4); `pnpm verify` chạy `test:db`/`test:queue`/`test:e2e` đồng thời trên một Postgres gây lỗi 57P01 giả, chạy tuần tự từng bước; merge `dev` `e9277e6`
