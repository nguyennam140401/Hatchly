# Implementation Plan: Kho mã nguồn chung chia module

**Branch**: `001-monorepo-module-skeleton` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-monorepo-module-skeleton/spec.md`

## Summary

Dựng kho mã nguồn chung (WBS 1.1) dạng **pnpm workspace** gồm `apps/server` (NestJS – hai điểm khởi
động `api` và `worker` từ cùng mã và cùng một ảnh container, ADR-01), `apps/web` (React + Vite, một
trang khởi đầu) và `packages/shared` (lược đồ **Zod** dùng chung, kiểu suy ra từ lược đồ). Máy chủ có
đủ **11 module** theo ADD mục 6, mỗi module một thư mục với `index.ts` là giao diện công khai duy nhất;
danh sách module, schema, phía chạy và **phụ thuộc được phép** nằm trong một tệp kê khai tập trung
`modules.manifest.json`, từ đó sinh quy tắc **dependency-cruiser** để chặn nhập nội bộ, vòng phụ thuộc,
phụ thuộc ngoài danh sách, web nhập mã máy chủ và gói dùng chung kéo thư viện máy chủ. Một lệnh
`pnpm verify` chạy kiểm tra kiểu nghiêm ngặt, lint, ranh giới, kiểm thử và quét gói web. Không tạo bảng
CSDL, không có hàng chờ thật (WBS 1.2, 1.3).

## Technical Context

**Language/Version**: TypeScript 5.9+ (strict) trên Node.js 24 LTS (R1, R11)

**Primary Dependencies**: NestJS 11 (`@nestjs/core`, `@nestjs/platform-express`), React 19, Vite,
Zod 4, pino + `nestjs-pino`, tsup (build shared), dependency-cruiser, ESLint 9 + typescript-eslint,
Prettier. Drizzle và pg-boss **chưa** cài – thuộc WBS 1.2/1.3. Phiên bản khóa chính xác (FR-020).

**Storage**: N/A ở tính năng này (chỉ khai báo tên schema trong tệp kê khai)

**Testing**: Vitest (cả ba gói; máy chủ dùng `unplugin-swc`), `@nestjs/testing` + supertest,
Testing Library + jsdom cho web, bộ mẫu vi phạm ranh giới trong `@app/tooling` (R12)

**Target Platform**: Container Linux (`node:24-bookworm-slim`) trên Kubernetes; máy phát triển
Windows 10/11 và Linux

**Project Type**: Web application – monorepo (SPA + API/Worker + gói dùng chung)

**Performance Goals**: `pnpm verify` ≤ 5 phút trên khung sạch (SC-006); Worker tắt ≤ 30 giây (SC-004)

**Constraints**: Một ảnh container cho API + Worker nhưng **hai Deployment độc lập** (co giãn riêng);
Worker không giữ trạng thái trong tiến trình, chạy nhiều bản song song được; Worker không có router nghiệp vụ; không thư viện
máy chủ trong gói web; không in bí mật; lệnh chạy được trên Windows và Linux

**Scale/Scope**: 3 gói ứng dụng + 1 gói công cụ, 11 module rỗng, 3 endpoint khung, ~6 lược đồ dùng chung

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Áp dụng vào tính năng | Đánh giá |
|---|---|---|
| I. Cô lập tenant | Chưa có bảng/phiên. Khung chuẩn bị chỗ: trường `account_id` trong nhật ký (rỗng tới WBS 2.1); `ApiRequestContext` không có đường nào nhận `accountId` từ param/body. RLS, biến phiên giao dịch thuộc WBS 1.2 | ✅ Đạt (không vi phạm; phần chính hoãn có chủ đích) |
| II. Đăng bài tin cậy | Ranh giới: chỉ `publishing` được phụ thuộc `platform_gateway` (quy tắc `allowed-deps`), bộ chuyển đổi nằm sau giao diện công khai của `platform_gateway` (ADR-05) | ✅ Đạt |
| III. Mọi lời gọi AI qua Cổng AI | Quy tắc `ai-sdk-only-in-ai-gateway` chặn nhập SDK AI ngoài `modules/ai_gateway`; hợp đồng cho khách chỉ có `UsagePercent`, `MicroUsd` không xuất hiện trong hợp đồng khách hàng (kiểm thử) | ✅ Đạt |
| IV. Modular monolith ranh giới cứng | 1 mã nguồn → `api` + `worker`, 1 ảnh, 2 Deployment – Worker co giãn độc lập trong khuôn ADR-01; 11 module, mỗi module một schema riêng (`platform_gateway` có schema riêng theo Clarifications; `approval` có schema `approval` dành sẵn, để trống – tuân thủ IV dù ADD mục 6 ghi không có bảng); chỉ dùng `index.ts`; kiểm tra tự động (cổng CI số 3, gắn CI ở WBS 1.4) | ✅ Đạt |
| V. Việc nền bền vững | Không có hàng chờ trong bộ nhớ; Worker tắt có kiểm soát ≤ 30 giây với điểm móc cho pg-boss (WBS 1.3) | ✅ Đạt |
| VI. AI đề xuất, con người quyết định | `ErrorResponse` bắt buộc ≥ 1 hành động khắc phục, thông điệp tiếng Việt, mã gốc chỉ trong `support.detail`; trang web hiển thị trạng thái bằng chữ + biểu tượng | ✅ Đạt |
| VII. Bí mật & dữ liệu cá nhân | Cấu hình không in giá trị; `redact` mặc định trong pino; lỗi 500 không lộ chi tiết; không gửi dữ liệu ra ngoài | ✅ Đạt |
| VIII. Quan sát được | Nhật ký JSON có `trace_id`, `unit`, `account_id`; tiêu đề `x-trace-id`. OpenTelemetry đầy đủ ở WBS 1.6 | ✅ Đạt (một phần có chủ đích) |
| IX. Đơn giản, chuẩn mở | Không thêm dịch vụ/hạ tầng; không Nx/Turborepo; thư viện khóa phiên bản; Zod bọc sau `core/validation`; không ADR mới cần thiết (công cụ phát triển không thuộc bảng ngăn xếp đã chốt) | ✅ Đạt |

**Cổng chất lượng CI** (hiến pháp): số 3 (phụ thuộc module) và số 4 (kiểu + lint) – lệnh có sẵn ở
đây; số 1, 2 (truy cập chéo, phát hiện bảng thiếu RLS) – WBS 1.2/1.4; số 5 (quét bí mật) – WBS 1.4.

**Kiểm tra lại sau Phase 1**: thiết kế ở `data-model.md` và `contracts/` không thêm thành phần hạ tầng,
không tạo bảng, giữ đồ thị phụ thuộc module không vòng (`content` không phụ thuộc `publishing`;
`account` không phụ thuộc `notifications` – dùng sự kiện qua `queue`). **Đạt, không có vi phạm.**

**Checklist kiến trúc** (`architecture.md` mục 13): module & giao diện công khai ✅ · bảng mới – không
có · việc nền – chưa có (khung tắt có kiểm soát sẵn) · AI qua AI Gateway ✅ (quy tắc tự động) · bộ đếm –
không có · không thêm hạ tầng ✅ · `trace_id` + nhật ký có cấu trúc, không log bí mật ✅ · migration –
không có.

## Project Structure

### Documentation (this feature)

```text
specs/001-monorepo-module-skeleton/
├── plan.md              # Tệp này
├── research.md          # Phase 0 – quyết định công cụ R1–R17
├── data-model.md        # Phase 1 – tệp kê khai module, hợp đồng dùng chung, cấu hình
├── quickstart.md        # Phase 1 – kịch bản kiểm chứng
├── contracts/
│   ├── module-manifest.md   # Định dạng tệp kê khai + quy tắc ranh giới
│   ├── http-api.md          # /healthz, /readyz, echo, ErrorResponse
│   └── repo-commands.md     # Lệnh gốc kho (giao diện cho CI WBS 1.4)
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks – chưa tạo)
```

### Source Code (repository root)

```text
package.json                 # scripts gốc (dev:*, build, typecheck, lint, check:boundaries, test, verify), packageManager, engines
pnpm-workspace.yaml          # apps/*, packages/*, tooling
pnpm-lock.yaml
.npmrc                       # save-exact, engine-strict
.nvmrc                       # 24
tsconfig.base.json           # strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
eslint.config.mjs            # flat config dùng chung
.prettierrc.json
.dependency-cruiser.cjs      # sinh quy tắc từ modules.manifest.json
.gitattributes               # eol=lf
.editorconfig
Dockerfile                   # một ảnh cho api + worker
.dockerignore
README.md                    # tài liệu khởi đầu tiếng Việt (FR-021)

apps/server/                 # @app/server
├── package.json
├── tsconfig.json / tsconfig.build.json
├── vitest.config.ts
├── .env.example
├── src/
│   ├── api.ts               # điểm khởi động API (NestFactory.create)
│   ├── worker.ts            # điểm khởi động Worker (createApplicationContext)
│   ├── app/
│   │   ├── api-app.module.ts
│   │   ├── worker-app.module.ts
│   │   └── module-registry.ts   # name → NestModule, lọc theo runsIn của tệp kê khai
│   ├── core/                # lõi dùng chung phía máy chủ – KHÔNG nhập modules/**
│   │   ├── config/          # lược đồ biến môi trường, loadConfig()
│   │   ├── logging/         # pino, redact, trace_id
│   │   ├── context/         # ApiRequestContext (traceId; accountId từ phiên – WBS 2.1)
│   │   ├── errors/          # AppError, bộ lọc ngoại lệ → ErrorResponse
│   │   ├── validation/      # ZodValidationPipe, @ValidBody/@ValidQuery/@ValidParam
│   │   ├── health/          # HealthController (api), worker-health-server (node:http)
│   │   ├── lifecycle/       # ShutdownCoordinator, trackInFlight()
│   │   └── diagnostics/     # DiagnosticsController (echo) – chỉ khi APP_ENV ≠ production
│   └── modules/
│       ├── modules.manifest.json
│       ├── modules.manifest.schema.json
│       ├── account/            { index.ts, account.module.ts, public-api.ts, internal/ }
│       ├── context/            …
│       ├── media/
│       ├── trends/
│       ├── content/
│       ├── approval/
│       ├── publishing/
│       ├── platform_gateway/
│       ├── ai_gateway/
│       ├── notifications/
│       └── queue/
└── test/
    ├── health.e2e.spec.ts
    ├── validation.e2e.spec.ts
    ├── config.spec.ts
    ├── manifest.spec.ts
    ├── shutdown.spec.ts     # tiến trình con thật, 10 lần
    └── multi-worker.spec.ts # 2 Worker + 1 API song song (SC-009)

apps/web/                    # @app/web
├── package.json, vite.config.ts, tsconfig.json, index.html
├── src/
│   ├── main.tsx
│   ├── app/StartPage.tsx    # trạng thái API: chữ + biểu tượng + "Thử lại"
│   └── lib/api-client.ts    # fetch + safeParse bằng @app/shared
└── test/StartPage.spec.tsx

packages/shared/             # @app/shared – chỉ phụ thuộc zod
├── package.json             # exports ".", "./core", "./*"; sideEffects: false
├── tsup.config.ts
├── src/
│   ├── index.ts
│   ├── core/                # ids, time, money, usage-percent, error-response, health, echo, vi-error-messages (toFieldErrors thuần, không đăng ký toàn cục)
│   └── modules/<11 module>/index.ts
└── test/

tooling/                     # @app/tooling
├── package.json
├── verify.mjs               # chạy hết các bước, in bảng tổng kết
├── check-web-bundle.mjs     # SC-008
└── boundaries/
    ├── build-rules.cjs      # tệp kê khai → quy tắc dependency-cruiser
    ├── fixtures/{a-internal-import,b-cycle,c-core-imports-module,d-web-imports-server,e-shared-imports-node,f-not-in-allowed-deps,clean}/
    └── boundaries.spec.ts
```

**Structure Decision**: monorepo theo bố cục đề xuất của `architecture.md` mục 4, thêm gói `tooling/`
cho mã công cụ (để quy tắc và bộ mẫu ranh giới có kiểm thử riêng, không lẫn vào mã ứng dụng). Ranh giới
được thực thi bằng đường dẫn: `apps/server/src/core` ↛ `modules`, `modules/X` → chỉ `modules/Y/index.ts`
với Y ∈ `allowedDeps`, `apps/web` → chỉ `@app/shared`, `packages/shared` → chỉ `zod`.

## Hình thái triển khai

**Chung ảnh ≠ chung tiến trình.** API và Worker dùng chung mã nguồn và một ảnh container (ADR-01,
hiến pháp IV) nhưng chạy là **hai Deployment Kubernetes riêng**, co giãn độc lập:

| | API | Worker |
|---|---|---|
| Deployment | `api` | `worker` |
| Lệnh khởi động | `node dist/api.js` (mặc định của ảnh) | `node dist/worker.js` (ghi đè `command`) |
| Số bản GĐ1 | 2 | 2 (tăng độc lập khi tải việc nền tăng) |
| CPU/RAM | Đặt riêng (nhẹ, nhiều yêu cầu ngắn) | Đặt riêng (nặng hơn: AI hàng loạt, xử lý video) |
| Kiểm tra sống/sẵn sàng | `/healthz`, `/readyz` cổng `API_PORT` | `/healthz` cổng `WORKER_HEALTH_PORT` |
| Tắt | `terminationGracePeriodSeconds: 40` | `terminationGracePeriodSeconds: 40`, chờ việc đang chạy ≤ 30 giây |
| Co giãn GĐ1 | HPA theo CPU | Chỉnh số bản tay hoặc HPA theo CPU |
| Co giãn sau | – | HPA theo độ dài hàng chờ / tuổi job chờ lâu nhất, qua Prometheus (T8) + Prometheus Adapter – WBS 1.5/1.6 |

- Các bản Worker cùng lấy việc từ hàng chờ pg-boss trong PostgreSQL (khóa từng job) nên tăng số bản là
  chia tải, không cần điều phối thêm. Không thêm KEDA hay thành phần mới khi chưa có ADR (nguyên tắc IX).
- Tính năng này bảo đảm điều kiện để co giãn: Worker không giữ trạng thái trong tiến trình, không ghi
  tệp cục bộ dùng chung, cổng kiểm tra sống cấu hình được (SC-009). Manifest Kubernetes/Terraform viết
  ở WBS 1.5.
- **Điều kiện xem lại** (cần ADR tách ảnh): ảnh dùng chung phình to vì ffmpeg (WBS 3.6) làm API khởi
  động chậm rõ rệt, hoặc cần tách Worker media riêng như hiến pháp IV đã dự liệu.

## Phạm vi giao cho các đầu việc sau

| Nội dung | Đầu việc |
|---|---|
| Drizzle, `pgSchema` theo tệp kê khai, biến phiên tenant, RLS mẫu, kiểm tra `/readyz` với CSDL | WBS 1.2 |
| pg-boss, 6 hàng chờ, gắn `ShutdownCoordinator` | WBS 1.3 |
| Gắn `pnpm verify` vào CI, kiểm thử truy cập chéo, quét bí mật | WBS 1.4 |
| OpenTelemetry thay `trace_id` tạm | WBS 1.6 |
| Định tuyến, điều hướng, thư viện thành phần web | WBS 1.7 |
| Giao diện công khai thật của `platform_gateway` và `ai_gateway` | WBS 1.8 |

Cập nhật `.specify/memory/architecture.md` (FR-023: mục 4 schema `platform_gateway`, module `approval` với schema `approval` dành sẵn;
mục 11 thuật ngữ mới từ `research.md`; tăng phiên bản 1.0 → 1.1) là một nhiệm vụ của tính năng này.

## Complexity Tracking

Không có vi phạm hiến pháp cần biện minh.
