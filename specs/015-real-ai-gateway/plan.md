# Implementation Plan: Cổng AI thật

**Branch**: `impl/015-real-ai-gateway` (thư mục spec `015-real-ai-gateway`) | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

**Input**: Đặc tả `specs/015-real-ai-gateway/spec.md` (đã làm rõ phiên 2026-11-19, 5 câu).

## Summary

Thay phần ruột giả của module `ai_gateway` (bản giả lập 005: kho bộ nhớ / bảng `sandbox.ai_fake_*`, bảng giá JSON,
hai nhà cung cấp giả) bằng bản thật, **giữ nguyên giao diện công khai `AiGatewayPublicApi` và `AiGatewayService`**
(trình tự validate → chọn bậc → ước tính → giữ chỗ → đánh dấu đang gọi → gọi → quyết toán/trả lại đã đúng ở 005). Việc
mới nằm ở ba chỗ cắm sẵn của 005 (`BudgetStore`, `PriceSource`, `AiProviderAdapter`) và vài mảnh còn thiếu:

1. **Kho ngân sách thật** trong schema `ai_gateway` (`ai_budgets`, `ai_reservations`, `ai_cost_ledger` + bản hệ thống
   `system_*`), giữ chỗ bằng MỘT `UPDATE … WHERE used + reserved + est <= cap`, `CHECK` làm chốt cuối; thêm **mã yêu cầu
   logic** chống tính tiền trùng (FR-037a) và **chu kỳ theo ngày kích hoạt** (FR-014).
2. **Cấu hình trong CSDL, đổi không cần phát hành**: bảng giá `model_prices` (hiệu lực theo thời điểm, đơn vị token hoặc
   phút âm thanh), định tuyến `model_routes` + dự phòng theo loại việc `task_fallback` (FR-024a), ngưỡng/trần `ai_settings`;
   thao tác đổi chỉ cho `admin`, có kiểm toán và kiểm tra bất hợp lý (FR-019a).
3. **Nhà cung cấp thật** sau `AiProviderAdapter` (ứng viên Anthropic + OpenAI, STT), bật bằng `AI_GATEWAY_DRIVER=real`;
   bản giả lập vẫn là mặc định dev/test và vẫn bị từ chối ở production.
4. **Vận hành**: việc nền dọn giữ chỗ treo (đã có từ 005, nối vào kho thật), phân bổ chi phí xu hướng theo ngành,
   kiểm tra ngưỡng 2 USD, đối soát hóa đơn; cảnh báo; khung nhìn chi tiết chi phí cho hỗ trợ có kiểm toán.

Hướng kỹ thuật: **chuyển nguyên logic đã được kiểm chứng của `SandboxBudgetStore` sang bảng thật** (đổi tên bảng,
thêm cột/ràng buộc), không viết lại luồng — rủi ro thấp nhất vì bộ kiểm thử hợp đồng 005 (14 mục) chạy lại nguyên vẹn
trên kho mới (FR-028).

## Technical Context

**Language/Version**: TypeScript nghiêm ngặt, Node.js 24 (`engines`), NestJS — giữ nguyên ngăn xếp đã chốt.

**Primary Dependencies**: Drizzle ORM + `drizzle-kit` (migration), pg-boss qua lớp `queue` của 003, `zod`; SDK nhà cung cấp AI
(Anthropic, OpenAI) **chỉ nhập trong `ai_gateway/internal/providers/`**, cố định phiên bản chính xác (hiến pháp IX); thêm
vào `package.json` của `apps/server` khi thi công, kiểm tra tuổi bản ≥ 2 tuần.

**Storage**: PostgreSQL có RLS. Schema `ai_gateway` (đã khai trong manifest). Tiền `bigint` micro-USD. Bảng sổ chi phí phân
vùng theo tháng (kiến trúc mục 8). Migration `0024`, `0025` (chỉ thêm, tương thích ngược).

**Testing**: Vitest — `pnpm test` (bộ nhớ), `pnpm test:db` (CSDL thật: hợp đồng AI, đồng thời, p95 ≤ 50 ms, RLS chéo tài
khoản), `pnpm test:queue` (việc nền), `pnpm check:boundaries`, `pnpm db:check`, `pnpm db:lint-migrations`.

**Target Platform**: `api` + `worker` (cùng ảnh container); việc nền chạy ở Worker.

**Project Type**: web-service (modular monolith) — chỉ chạm `apps/server`, `packages/shared` (quyền), tài liệu.

**Performance Goals**: kiểm tra + giữ chỗ ngân sách p95 ≤ 50 ms (FR-009/SC-003); tạo bài p95 ≤ 45 s, chữ đầu ≤ 5 s do nhà
cung cấp + giữ chỗ không thêm độ trễ đáng kể.

**Constraints**: không cache ngân sách; không số thực với tiền; không lời nhắc/kết quả/số tiền trong nhật ký kỹ thuật; khách
chỉ thấy %; không thêm hạ tầng mới (không Redis, không broker).

**Scale/Scope**: ~500 lời gọi AI/ngày giai đoạn 1, chịu 10×; 1 chủ + 2 cộng tác viên dùng chung một ngân sách; vài chục ngành.

**Phụ thuộc ngoài chưa chốt** (không chặn kế hoạch, xem `research.md` R-12, R-13): POC-1/POC-4 (nhà cung cấp, giá thật),
POC-3 (mức USD mỗi ngành), mô hình gói/chu kỳ của `account` (chu kỳ tạm theo ngày kích hoạt).

## Constitution Check

*GATE: đạt trước Phase 0; đánh giá lại sau Phase 1 — **đạt, không có vi phạm cần ghi Complexity Tracking**.*

| # | Nguyên tắc | Đánh giá | Cách đáp ứng |
|---|---|---|---|
| I | Cô lập tenant | ✅ | `ai_budgets`, `ai_reservations`, `ai_cost_ledger`, `ai_trend_allocations` là bảng `tenantTable` (RLS `tenant_isolation`, `account_id` đầu chỉ mục); mã tài khoản lấy từ ngữ cảnh, không từ tham số. Bảng hệ thống/cấu hình là `sharedTable` có `reason`, chỉ vai trò `system` ghi. Khung nhìn hỗ trợ đi qua `supportViewAccount` + kiểm toán. Kiểm thử truy cập chéo cho mọi bảng tenant mới. |
| II | Đăng bài tin cậy | ➖ | Không chạm đăng bài. Cổng AI không nằm trên đường đăng. |
| III | Cổng AI chặn trước khi gọi | ✅ | Trọng tâm tính năng. Giữ chỗ bằng một cập nhật có điều kiện + `CHECK (used + reserved <= cap)`; quyết toán/trả lại; 2 USD mềm, 4 USD cứng; micro-USD `bigint`; không cache; sổ chi phí; bảng giá là dữ liệu; khách chỉ thấy %. |
| IV | Ranh giới module | ✅ | Schema `ai_gateway` riêng; không FK sang module khác (chỉ tới `accounts`); `account`, `notifications`, `queue` qua giao diện công khai (đã có trong `allowedDeps`). Nguồn số ngành và danh sách tài khoản theo ngành do `trends`/`context` **cắm vào bằng cổng đảo ngược** (không thêm mũi tên phụ thuộc mới cho `ai_gateway`). Sự kiện 80/100% tạo trong cùng giao dịch quyết toán. |
| V | Việc nền bền vững, chạy lại an toàn | ✅ | Dọn giữ chỗ treo, phân bổ chi phí, kiểm tra ngưỡng, đối soát hóa đơn đều là việc pg-boss, khóa chống trùng, chạy lại hai lần cho cùng kết quả; mã yêu cầu logic chống trừ tiền hai lần (FR-037a). |
| VI | AI đề xuất, người quyết định | ✅ | Khi bị chặn người dùng vẫn làm tay (không đổi hành vi của module gọi); thông điệp tiếng Việt + hành động khắc phục. |
| VII | Bí mật & dữ liệu cá nhân | ✅ | Khóa nhà cung cấp là `Secret` Kubernetes (theo `worker-secrets`/`api-secrets`), không vào nhật ký/sổ; dữ liệu gửi ra tối thiểu; nhà cung cấp mới ở nước ngoài ghi vào danh sách chuyển dữ liệu xuyên biên giới; không lưu lời nhắc/kết quả. |
| VIII | Quan sát được | ✅ | `trace_id` xuyên suốt; nhật ký `ai_gateway.<op>` không nội dung/tiền; chỉ số OpenTelemetry; cảnh báo > 5% chạm 2 USD, lệch hóa đơn > 5%, lỗi nhà cung cấp > 5%/15 phút; thao tác quản trị giá được kiểm toán. |
| IX | Đơn giản, chuẩn mở | ✅ | Không thêm hạ tầng; SDK cố định phiên bản, bọc sau `AiProviderAdapter`; chưa chốt nhà cung cấp nên adapter + cấu hình định tuyến, không ADR mới. Chọn nhà cung cấp cuối cùng vẫn chờ POC-1/POC-4 (không bị tính năng này vượt mặt). |

**Rủi ro/ghi nhận (không phải vi phạm):**
- Thêm **một phương thức nhỏ** vào `AccountPublicApi` (mốc chu kỳ) và **một trường tùy chọn + một mã lỗi** vào giao diện
  005 (`requestId`, `AI_DUPLICATE_REQUEST`) — đều cộng thêm, tương thích ngược; cập nhật `contracts/` và test hợp đồng.
- Mức USD mỗi ngành/giá ban đầu là giả định (SA chốt tạm) — nằm ở cấu hình, không ở mã.

## Project Structure

### Documentation (this feature)

```text
specs/015-real-ai-gateway/
├── plan.md              # File này
├── research.md          # Phase 0 — quyết định + phương án đã loại
├── data-model.md        # Phase 1 — bảng, ràng buộc, trạng thái, ánh xạ tên Việt→Anh
├── quickstart.md        # Phase 1 — các kịch bản kiểm chứng chạy được
├── contracts/
│   ├── ai-gateway-delta.md      # Thay đổi giao diện công khai so với 005 (cộng thêm)
│   ├── provider-adapter.md      # Giao diện nhà cung cấp + định tuyến + dự phòng theo loại việc
│   ├── admin-ops.md             # Điểm cuối quản trị/hỗ trợ + cổng đảo ngược cho trends
│   └── jobs-and-alerts.md       # Việc nền, khóa chống trùng, cảnh báo, chỉ số
├── checklists/requirements.md
└── tasks.md             # Do /speckit-tasks tạo — KHÔNG tạo ở bước này
```

### Source Code (repository root)

```text
apps/server/
├── drizzle/migrations/
│   ├── 0024_ai_gateway_tables.sql         # bảng tenant + hệ thống + cấu hình, RLS, CHECK, phân vùng sổ chi phí
│   └── 0025_ai_gateway_seed_support.sql   # dòng cấu hình khởi đầu (giá giả định), khung nhìn hỗ trợ, quyền vai trò
├── src/
│   ├── core/config/config.schema.ts       # AI_GATEWAY_DRIVER thêm 'real'; khóa nhà cung cấp bắt buộc khi real; TTL giá…
│   └── modules/
│       ├── account/                       # + getAiCycleAnchor() (cộng thêm, công khai)
│       └── ai_gateway/
│           ├── public-api.ts              # + requestId?, AiError 'AI_DUPLICATE_REQUEST' (cộng thêm)
│           ├── ai_gateway.module.ts       # chọn driver fake | real; nối cổng đảo ngược
│           ├── jobs.ts                    # + allocate_trend_cost, check_thresholds, reconcile_invoices
│           └── internal/
│               ├── db/schema.ts           # bảng tenantTable/sharedTable của schema ai_gateway
│               ├── db/ai-cost-ledger.log-table.ts   # sổ chi phí phân vùng (khuôn publish-steps)
│               ├── budget/db-budget-store.ts        # BudgetStore thật (chuyển từ SandboxBudgetStore)
│               ├── budget/cycle.ts                  # mốc chu kỳ theo ngày kích hoạt, ngày cuối tháng
│               ├── prices/db-price-source.ts        # PriceSource đọc model_prices, bộ nhớ đệm TTL ngắn
│               ├── routing/route-book.ts            # model_routes + task_fallback
│               ├── settings/ai-settings.ts          # trần/ngưỡng/mức USD mỗi ngành
│               ├── admin/{pricing,settings}.service.ts + admin.controller.ts
│               ├── providers/{anthropic,openai,token-estimate}.ts
│               ├── alerts/{threshold-check,invoice-reconcile}.ts
│               └── allocation/trend-allocation.ts   # chia đều chi phí xu hướng theo ngành
└── test/
    ├── contracts/ai/                      # chạy lại bộ hợp đồng 005 trên kho thật (+ mục mới)
    ├── ai_gateway/                        # idempotency, cycle, price, routing, admin, allocation, RLS chéo
    └── queue/ai_gateway-*.spec.ts

packages/shared/src/auth/permissions.ts    # + 'ai.pricing.manage' (admin), 'ai.cost.view' (support, admin)
docs/wiki/                                 # cập nhật ở bước ingest sau implement (hook), không làm ở đây
```

**Structure Decision**: Một module có sẵn (`ai_gateway`), không thêm module/dịch vụ. Mọi thay đổi nằm trong
`apps/server/src/modules/ai_gateway/**`, hai migration, một phương thức ở `account`, một dòng cấu hình, hai quyền ở
`packages/shared`. Bản giả lập (`internal/fake/**`, bảng `sandbox.ai_fake_*`) giữ nguyên làm công cụ phát triển/kiểm thử.

## Complexity Tracking

Không có vi phạm hiến pháp cần biện minh.
