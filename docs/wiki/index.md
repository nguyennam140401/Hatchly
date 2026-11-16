# Wiki tra cứu cho agent

Schema, quy trình ingest/query/lint: [`AGENTS.md`](../../AGENTS.md). Bắt đầu đọc từ đây. Cập nhật khi thêm/sửa trang.

## Chung

- [glossary.md](glossary.md) — thuật ngữ Việt → Anh (current)
- [open-questions.md](open-questions.md) — việc còn mở, giả định chưa kiểm chứng (current)
- [log.md](log.md) — nhật ký thay đổi wiki

## Tính năng

- [001-monorepo-module-skeleton.md](features/001-monorepo-module-skeleton.md) — 001 – Kho mã nguồn chung chia module ( current)
- [002-db-layer-tenant-rls.md](features/002-db-layer-tenant-rls.md) — 002 – Lớp CSDL, cô lập tenant bằng RLS ( current)
- [003-queue-layer-pgboss.md](features/003-queue-layer-pgboss.md) — 003 – Lớp hàng chờ pg-boss ( current)
- [004-minimal-auth-rbac.md](features/004-minimal-auth-rbac.md) — 004 – Xác thực tối thiểu và phân quyền RBAC ( current)
- [005-gateway-contracts-fakes.md](features/005-gateway-contracts-fakes.md) — 005 – Hợp đồng cổng + bản giả lập (nền tảng, AI, thông báo, kho tệp) ( current)
- [006-sample-module-business-profile.md](features/006-sample-module-business-profile.md) — 006 – Module mẫu "Hồ sơ kinh doanh" (lát dọc màn hình → CSDL) ( current)
- [007-terraform-infra-environments.md](features/007-terraform-infra-environments.md) — 007 Hạ tầng Terraform – staging và production ( current)
- [008-cicd-jenkins-pipeline.md](features/008-cicd-jenkins-pipeline.md) — 008 CI/CD Jenkins cho test và release ( current)
- [009-social-login-members.md](features/009-social-login-members.md) — 009 Đăng nhập Google/Facebook và thành viên ( draft)
- [011-ui-architecture-foundation.md](features/011-ui-architecture-foundation.md) — 011 Nền kiến trúc giao diện; **còn T074** ( draft)

## Module

- [account.md](modules/account.md) — Module account (Tài khoản & Gói) ( current)
- [ai_gateway.md](modules/ai_gateway.md) — Module ai_gateway (Cổng AI) ( draft)
- [approval.md](modules/approval.md) — Module approval (Duyệt & lịch) ( draft)
- [content.md](modules/content.md) — Module content (Nội dung) ( draft)
- [context.md](modules/context.md) — Module context (Ngữ cảnh kinh doanh) ( current)
- [media.md](modules/media.md) — Module media (Thư viện media) ( draft)
- [notifications.md](modules/notifications.md) — Module notifications (Thông báo) ( draft)
- [platform_gateway.md](modules/platform_gateway.md) — Module platform_gateway (Cổng nền tảng) ( draft)
- [publishing.md](modules/publishing.md) — Module publishing (Đăng bài) ( draft)
- [queue.md](modules/queue.md) — Module queue (Hàng chờ – hạ tầng) ( current)
- [trends.md](modules/trends.md) — Module trends (Xu hướng) ( draft)

## Khái niệm xuyên module

- [ai-budget.md](concepts/ai-budget.md) — Ngân sách AI và Cổng AI ( draft)
- [auth-rbac.md](concepts/auth-rbac.md) — Xác thực và phân quyền (RBAC) ( current)
- [ci-cd.md](concepts/ci-cd.md) — CI/CD với Jenkins và cổng chất lượng ( current)
- [feature-status.md](concepts/feature-status.md) — Danh sách tính năng và trạng thái đáp ứng ( current)
- [infra-envs.md](concepts/infra-envs.md) — Hạ tầng và môi trường (Terraform, VNG Cloud) ( current)
- [migrations.md](concepts/migrations.md) — Migration CSDL tương thích ngược ( current)
- [module-boundaries.md](concepts/module-boundaries.md) — Ranh giới module (modular monolith) ( current)
- [publish-idempotency.md](concepts/publish-idempotency.md) — Đăng bài không trùng (thiết kế) ( draft)
- [queues.md](concepts/queues.md) — Hàng chờ và việc nền (pg-boss) ( current)
- [tenant-rls.md](concepts/tenant-rls.md) — Cô lập tenant bằng RLS ( current)
- [web-ui.md](concepts/web-ui.md) — Kiến trúc giao diện web: lớp thư mục, token, dữ liệu, biểu mẫu, cổng ( current)

## Quyết định (ADR)

- [index.md](decisions/index.md) — Chỉ mục quyết định kiến trúc (ADR-01…11) ( current)

## Hướng dẫn thao tác

- [add-migration.md](howto/add-migration.md) — Thêm migration CSDL ( current)
- [add-module.md](howto/add-module.md) — Thêm module hoặc tính năng nghiệp vụ ( current)
- [deploy-and-rollback.md](howto/deploy-and-rollback.md) — Triển khai và quay về bản trước ( draft)
- [run-tests.md](howto/run-tests.md) — Chạy kiểm thử và cổng chất lượng ( current)
