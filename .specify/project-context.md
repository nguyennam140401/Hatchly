# Ngữ cảnh dự án (đã điền cho dự án này; kiểm tra lại bằng /pm-init)

## Tổng quan
- Ứng dụng web thương mại giúp chủ kinh doanh nhỏ lập kế hoạch, tạo bằng AI, duyệt, lên lịch và đăng bài lên Facebook Page, Instagram, Zalo OA. Nhiều tenant (1 chủ + tối đa 2 cộng tác viên).
- Quy tắc tối cao: `.specify/memory/constitution.md` (9 nguyên tắc; I, II, III không thương lượng). Tổng quan kiến trúc: `.specify/memory/architecture.md`. Tra cứu nhanh: `docs/wiki/index.md`.
- Ngôn ngữ: tài liệu, chú thích mã, giao diện bằng tiếng Việt; mọi định danh bằng tiếng Anh (ánh xạ ở `architecture.md` mục 11).

## Ngăn xếp (đã chốt, đổi cần ADR)
- TypeScript toàn bộ. Giao diện: React + Vite (`apps/web`). API + Worker: NestJS + Drizzle + pg-boss (`apps/server`, một mã nguồn hai đơn vị triển khai). Dùng chung: `packages/shared`.
- PostgreSQL có RLS; kho tệp tương thích S3; Kubernetes; OpenTelemetry. Không Redis, không message broker, không microservice ở giai đoạn 1.
- Nhà cung cấp AI chưa chốt: chỉ gọi qua module `ai_gateway`.

## Cấu trúc chính
- `apps/server/src/{core,modules,app,db,ops,api.ts,worker.ts}`; mỗi module ở `modules/<tên>/{index.ts,public-api.ts,<tên>.module.ts,jobs.ts,internal/**}`, schema DB ở `internal/db/`. Quy tắc ranh giới: `modules.manifest.json`.
- `apps/server/drizzle/{migrations,migrations-dev,bootstrap}`. Kiểm thử: `apps/server/test`, `apps/web/test`, `apps/web/e2e`, `e2e`, `tooling/test`.
- `infra/` (Terraform), `ops/`, `.github/`, `tooling/` (kiểm tra CI), `docs/{adr,ci-cd,wiki}`, `specs/<NNN-tên>/`.

## Lệnh chuẩn (pnpm, Node 24)
- Cài: `pnpm install`. Chạy: `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:web`. DB cục bộ: `pnpm db:up`, `pnpm db:setup`, `pnpm db:migrate`.
- Kiểm tra: `pnpm typecheck`, `pnpm lint`, `pnpm check:boundaries`, `pnpm check:secrets`, `pnpm check:web-rules`, `pnpm check:web-bundle`, `pnpm wiki:check`. Toàn bộ cổng: `pnpm verify`.
- Kiểm thử: `pnpm test`, `pnpm test:db`, `pnpm test:queue`, `pnpm test:compat`, `pnpm test:infra`, `pnpm test:e2e`, `pnpm test:web-e2e`.
- Script PowerShell của speckit: `powershell -NoProfile -ExecutionPolicy Bypass -File .specify/scripts/powershell/<tên>.ps1`.

## Quy ước và bẫy
- DB chỉ qua `tenantTx`/`systemTx`/`support*`; dùng `account.current_account_id()`. Mã tài khoản lấy từ phiên.
- Tiền là micro-USD nguyên; `timestamptz` UTC, hiển thị UTC+7; khóa chính UUID v7. Không bao giờ hiển thị số tiền USD chi phí AI cho khách.
- Worktree theo tính năng: `.claude/worktrees/<NNN-…>` trên nhánh `impl/<NNN-…>`; commit và merge do người dùng quyết qua `speckit-worktree-finish`. Không chạy docker compose ở hai checkout cùng lúc (cổng 3000/3001/8080).

## Điều cấm
- Không đổi ngăn xếp hoặc đi ngược ADR khi chưa có ADR mới; không thêm cache phân tán, message broker, dịch vụ mới; không đọc `.env`.
