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
vùng theo tháng (kiến trúc mục 8). Migration `0029`, `0030`, `0031` (chỉ thêm, tương thích ngược; `0024`/`0025` đã bị 010 dùng, hiện có tới `0028` trước 015).

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

*GATE: đạt trước Phase 0; đánh giá lại sau Phase 1 — **đạt; một lệch câu chữ về chu kỳ (không phải nguyên tắc I-III) ghi ở Complexity Tracking**.*

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
│   ├── 0029_ai_gateway_tables.sql         # bảng tenant + hệ thống + cấu hình, RLS, CHECK, phân vùng sổ chi phí
│   ├── 0030_ai_gateway_seed_support.sql   # dòng cấu hình khởi đầu (giá giả định), khung nhìn hỗ trợ, thu quyền ghi cấu hình của `system`
│   └── 0031_ai_gateway_admin_functions.sql # hàm SECURITY DEFINER admin_* (kiểm 10×, TTL, kiểm toán), EXECUTE chỉ `support`
│   ├── 0032_ai_gateway_summary_functions.sql # hàm tóm tắt SECURITY DEFINER (data-dev)
│   └── 0033_ai_gateway_worker_helpers.sql    # hàm hỗ trợ việc nền; gồm account.count_active_accounts() (module account, SECURITY DEFINER, EXECUTE chỉ `system`) (data-dev)
├── drizzle/migrations/meta/_journal.json  # đã có mục 0029 đến 0033 (xác nhận bằng `pnpm db:check`)
├── src/modules/queue/run-for-account.ts   # runForAccount, chỉ chạy trong việc nền (backend-dev)
│   (ai_gateway chỉ gọi đếm tài khoản qua AccountPublicApi.countActiveAccounts)
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
│               ├── admin/{pricing,settings,routes,invoices}.service.ts + admin.controller.ts + support.controller.ts
│               ├── metrics.ts                       # chỉ số OpenTelemetry (không nhãn tiền/nội dung)
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

## Phân chia sở hữu

Mọi tệp trong `apps/server/src/modules/ai_gateway/**` và `account/` (+ test): backend-dev. Năm migration `0029` đến `0033` và
`drizzle/migrations/meta/_journal.json`: data-dev. `packages/shared/src/auth/permissions.ts`: backend-dev. Tài liệu bên dưới: SA/PM.

## Tài liệu dev không ghi được (SA/PM xử lý khi ingest hoặc ngay)

- **Danh sách chuyển dữ liệu xuyên biên giới**: file đích `TaiLieuDacTa/Kien_truc_Du_lieu_Cache_App_AI_Content_MXH.md` mục 9; thêm
  từng nhà cung cấp AI/STT nước ngoài bật ở production (Anthropic, OpenAI): dữ liệu gửi (lời nhắc tối thiểu, khung hình thu nhỏ,
  âm thanh), mục đích, cam kết không huấn luyện. Chưa ghi thì không bật `AI_GATEWAY_DRIVER=real` ở production (R-17). Ghi chú ở
  `.specify/memory/architecture.md` (bảng thuật ngữ mục 11) cũng thêm các ánh xạ trong data-model.md mục 1.
- **Hợp đồng cho `trends`/`context`**: hai cổng đảo ngược `ActiveIndustriesSource`, `IndustryAccountsSource` (định nghĩa ở
  `contracts/ai-gateway-delta.md`); `trends` hoặc `context` cung cấp hiện thực qua token Nest, không đổi `allowedDeps` của
  `ai_gateway`. Cần ghi một dòng vào hợp đồng/wiki của `trends` và `context`; chưa có hiện thực thì dùng trần tuần tạm.
- **Hợp đồng 005**: đã thêm `AI_DUPLICATE_REQUEST`, `AI_NOT_CONFIGURED` vào `AiError.code` trong
  `specs/005-gateway-contracts-fakes/contracts/ai-gateway.md` (đã sửa).
- Khung nhìn hỗ trợ thật: `ai_gateway.support_ai_budget_detail`, `ai_gateway.support_ai_cost_ledger`, `ai_gateway.support_ai_trend_allocations`.
- `AI_PRICE_CACHE_TTL_MS`: tối đa 60000 ms (60 giây); là lead-time tối thiểu của `effective_from` (R-06).

## Rủi ro đã ghi nhận

- Sổ `ai_cost_ledger` là bảng phân vùng nên **không có UNIQUE theo `reservation_id`**. Quyết toán idempotent dựa vào
  `UPDATE ai_reservations … WHERE state = <hiện tại>` trong cùng giao dịch với `INSERT` sổ (cập nhật không khớp → không ghi sổ).
- Phân vùng tháng của sổ do Worker tạo trước. Nếu lịch tạo phân vùng ngừng > 2 tháng, ghi sổ sẽ lỗi → cần cảnh báo thiếu phân
  vùng (nối vào T066/T069).

## Rủi ro và việc mở sau thi công

- Gauge `open_reservations` đã nối và cảnh báo T069 đã viết; thêm bộ đếm `ai_gateway_events_total` cho các sự kiện nhật ký.
- SC-013 (đã chốt): nhóm cảnh báo theo sự kiện/tỷ lệ đến đội vận hành ≤ 15 phút từ lúc điều kiện xảy ra; `check_thresholds` chạy mỗi 5 phút (`*/5 * * * *`) với quy tắc cửa sổ [10m] for 0m (≈ 11 phút). Đối soát hóa đơn chạy hằng ngày: SC-013 hiểu là ≤ 15 phút sau khi đối soát phát hiện lệch.
- SC-009 "chi phí thực không vượt ước tính" chỉ đúng khi bên gọi (module media) cắt 5 phút đầu trước khi gọi (FR-021 phía gọi). Tệp dài hơn gửi cả tệp (≤ 25 MB) → `over_estimate`, chi phí tính theo thời lượng thực; module media chịu trách nhiệm cắt.
- Chưa có bề mặt khách (API/giao diện) cho `getUsage`: thuộc module Tài khoản & Gói (Spec Assumptions).
- Mã/migration phát sinh ngoài danh sách nhiệm vụ ban đầu: migration `0031`, `0032`, `0033`; `core/db/errors.ts`; `core/gateways/{op-log.ts,selection.ts}`; `modules/queue/run-for-account.ts`; `account/internal/count-active-accounts.ts`; `tooling/boundaries/*`; `vitest*.mts`; `.specify/ownership.json` (mở rộng quyền ghi: `vitest*.mts` cho qa, `.dependency-cruiser.cjs` cho devops-dev, `migrations/meta/_journal.json` vào tệp dùng chung).
- Seed giá/mô hình ở `0030` là **giá giả định**, chờ POC-1/3/4; không dùng cho production cho tới khi thay bằng giá thật (dòng `model_prices` mới qua `admin_add_price`).
- Anthropic chỉ có cam kết hợp đồng về không huấn luyện: cần đưa vào hồ sơ chuyển dữ liệu xuyên biên giới (Q-D3) trước ngày ra mắt. Đã ghi ở
  Kiến trúc dữ liệu mục 9 (T049a: hook chặn SA ghi tệp đó, PM giao chủ sở hữu thêm dòng).

## Ghi nhận phân bổ chi phí xu hướng (`ai_trend_allocations`)

Bảng tenant có RLS nên không ghi hàng loạt bằng một câu lệnh chéo tài khoản. Việc `allocate_trend_cost` (`scope: 'system'`) lấy danh
sách tài khoản từ `IndustryAccountsSource`, rồi mỗi tài khoản một giao dịch `systemTx` đặt ngữ cảnh tài khoản đó, `INSERT … ON
CONFLICT DO NOTHING` theo khóa duy nhất. Có kiểm thử chạy lại hai lần cho cùng kết quả và RLS chéo tài khoản.

## Complexity Tracking

| Lệch/ghi nhận | Vì sao cần | Phương án đơn giản hơn đã loại |
|---|---|---|
| Anthropic không có cờ không-huấn-luyện kỹ thuật; chỉ có cam kết hợp đồng (hiến pháp VII); lệch so với T045a/T046 (cờ ở cả hai adapter, xem T045a) | Nhà cung cấp không cho cấu hình này; cần đưa vào hồ sơ chuyển dữ liệu xuyên biên giới (Q-D3) trước ra mắt | Bỏ Anthropic: mất mô hình chất lượng đã chọn khi chưa có kết quả POC-1 |
| Seed giá/mô hình giả định, chờ POC-1/3/4, không dùng production | Cần dữ liệu khởi đầu để chạy và kiểm thử thật | Chặn thi công tới khi có POC: không kiểm thử được cổng |
| Mốc 100% tính theo số đã quyết toán, không tính giữ chỗ | Giữ chỗ có thể trả lại; thông báo "đã dùng hết" sai thì không sửa được | Tính cả giữ chỗ: dễ báo sai |
| STT ước lượng `over_estimate` khi tệp > 300 s | Nhà cung cấp tính tiền theo thời lượng thật; ước cao để không vượt trần | Ước theo thời lượng thật: không biết trước, có thể vượt trần |
| Mốc 80% tính theo số đã quyết toán (`used`), còn phần trăm hiển thị tính `used + reserved` (spec US6 kịch bản 1) | Thông báo chỉ theo số bền, tránh phát nhầm không sửa được | Tính mốc theo `used + reserved`: phát nhầm khi giữ chỗ được trả lại |
| Hóa đơn 0 mà sổ > 0 → lệch 100% | Tránh chia cho 0 và vẫn cảnh báo | Bỏ qua: che mất sai lệch thật |
| Số ngành 0 hoặc thiếu nguồn → trần tạm kèm cảnh báo | Không chia cho 0, không chặn xu hướng | Dừng việc: mất tổng hợp tuần |
| Ngân sách hệ thống ghi qua hàm SECURITY DEFINER (API không có bể `system`) | Giữ API không có quyền ghi chéo tenant (nguyên tắc I) | Cấp bể `system` cho API: mở rộng quyền không cần thiết |
| Không giới hạn đồng thời 1 theo tên việc `scheduled` (hạ tầng tính theo hàng); khóa theo khung giờ đủ chống chạy trùng | Hạ tầng hàng chờ không hỗ trợ theo tên việc | Thêm cơ chế khóa mới trong `queue`: ngoài phạm vi |
| `release_stale` của tenant hẹn riêng từng giữ chỗ, không có lưới quét định kỳ | Đơn giản; rủi ro đã nêu, cảnh báo `AiOpenReservationsStuck` phát hiện | Việc quét định kỳ mọi tenant: thêm tải và đường chạy chéo tenant |
| Nhãn `account_id` trong `ai_gateway_calls_total` có cardinality cao khi tải ×10 | Hiến pháp VIII yêu cầu chỉ số gắn mã tài khoản; theo dõi khi lên quy mô | Bỏ nhãn: vi phạm VIII |
| Chu kỳ ngân sách tạm theo **ngày tạo của tài khoản `active`** (`getAiCycleAnchor()`), lệch chữ "ngày kích hoạt gói" của hiến pháp (mục Quy ước dữ liệu) | Module `account` chưa có `subscriptions`/`usage_cycles`; cần chu kỳ lặp hằng tháng (ngày cuối tháng nếu thiếu) để Cổng AI chạy thật | Chu kỳ theo tháng lịch (lệch hơn nữa so với hiến pháp, và đổi sau sẽ phải di chuyển dữ liệu). Hợp nhất lại khi mô hình gói có: chỉ đổi phần hiện thực trong `account`, giao diện giữ nguyên |

Kết luận (theo `reviews/constitution-review.md`, `reviews/us7-us8.md`): không vi phạm nguyên tắc I-IX; I, II, III đạt, VII đạt có điều kiện.

**Điều kiện còn treo trước khi bật `AI_GATEWAY_DRIVER=real` ở production:**

- (a) Nguyên tắc VII: cam kết hợp đồng không dùng dữ liệu để huấn luyện của Anthropic (API không có cờ kỹ thuật) và của OpenAI (`store:false`) phải có bằng chứng trước ngày ra mắt, đưa vào hồ sơ đánh giá chuyển dữ liệu xuyên biên giới (Q-D3/C6).
- (b) Bảng mục 9 của `TaiLieuDacTa/Kien_truc_Du_lieu_Cache_App_AI_Content_MXH.md` thêm Anthropic và OpenAI (T049a, chờ người dùng).
- (c) Seed giá/mô hình giả định (migration 0030) thay bằng giá thật sau POC-1/POC-3/POC-4 (thêm dòng `model_prices` mới qua `admin_add_price`).
- (d) Đưa khóa API vào Secret (`api-secrets`/`worker-secrets`); cần đủ khóa cho mọi nhà cung cấp trong tuyến đang bật.
