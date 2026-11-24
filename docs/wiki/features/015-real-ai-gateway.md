---
type: feature
title: 015 Cổng AI thật
sources:
  [
    specs/015-real-ai-gateway/spec.md,
    specs/015-real-ai-gateway/plan.md,
    specs/015-real-ai-gateway/tasks.md,
    specs/015-real-ai-gateway/research.md,
    specs/015-real-ai-gateway/data-model.md,
    specs/015-real-ai-gateway/acceptance-report.md,
    specs/015-real-ai-gateway/contracts/ai-gateway-delta.md,
    specs/015-real-ai-gateway/contracts/provider-adapter.md,
    specs/015-real-ai-gateway/contracts/admin-ops.md,
    specs/015-real-ai-gateway/contracts/jobs-and-alerts.md,
    specs/015-real-ai-gateway/reviews/constitution-review.md,
    apps/server/drizzle/migrations/0029_ai_gateway_tables.sql,
    apps/server/drizzle/migrations/0030_ai_gateway_seed_support.sql,
    apps/server/drizzle/migrations/0031_ai_gateway_admin_functions.sql,
    apps/server/drizzle/migrations/0032_ai_gateway_summary_functions.sql,
    apps/server/drizzle/migrations/0033_ai_gateway_worker_helpers.sql,
    apps/server/src/modules/ai_gateway/jobs.ts,
    apps/server/docs/ai-gateway.md,
    apps/server/docs/ai-gateway-providers.md,
    ops/alerts/ai_gateway.rules.yml,
  ]
updated: 2026-11-24
status: draft
related:
  [
    modules/ai_gateway.md,
    concepts/ai-budget.md,
    concepts/queues.md,
    concepts/tenant-rls.md,
    concepts/feature-status.md,
    features/005-gateway-contracts-fakes.md,
    open-questions.md,
  ]
---

# 015 Cổng AI thật

> **CÒN ĐIỀU KIỆN NGOÀI.** 97/101 việc xong; 4 việc còn lại: **T004** (bỏ), **T057a** (không cần), **T049a** (thêm Anthropic/OpenAI vào bảng mục 9 của
> `TaiLieuDacTa/Kien_truc_Du_lieu_Cache_App_AI_Content_MXH.md`, hook chặn agent ghi — người dùng tự thêm) và **T073a** (ghi kết quả đo POC-1/POC-4 khi có khóa
> thật). Đã merge `dev` (`ac19fc1`); nhánh `impl/015-real-ai-gateway` và worktree được **giữ**. **Chưa bật `AI_GATEWAY_DRIVER=real` ở production** (xem "Điều kiện trước production").

## Mục tiêu

Thay kho giả của 005 bằng Cổng AI thật: ngân sách và giữ chỗ **bền trong PostgreSQL**, chặn trước khi gọi bằng **một câu UPDATE có điều kiện**, quyết toán/trả lại trong
một giao dịch, chọn bậc mô hình theo mức dùng (ngưỡng mềm 2 USD, cứng 4 USD, tiền là số nguyên micro-USD), sổ chi phí chỉ-thêm, bảng giá và tuyến cấu hình được
(không phát hành lại), nhà cung cấp dự phòng, chuyển giọng nói theo phút, thông báo 80%/100% không lộ tiền, ngân sách hệ thống theo tuần cho xu hướng, cảnh báo vận hành
và đối soát hóa đơn. Hai bộ chuyển đổi Anthropic và OpenAI nằm sau giao diện nội bộ; mặc định dev/test vẫn là bản giả.

## Mã FR/NFR

FR-001…FR-038 của spec 015 (ngân sách, giữ chỗ, bậc mô hình, sổ, bảng giá, dự phòng, STT, thông báo, ngân sách hệ thống, vận hành), SC-001…SC-014; hiến pháp I, III, IV, V,
VII, VIII. Truy vết về FR-11, FR-12 của đặc tả gốc.

## Trạng thái

`draft` (97/101, phần còn lại chờ điều kiện ngoài). Sau khi gộp `dev`, `pnpm verify` đạt 15/18 bước; `test:web-e2e` đỏ 5 ca chập chờn khi cả bộ chạy nhưng chạy lại
riêng đạt 51/51; `infra:check` bỏ qua (máy chưa cài terraform). Kiểm thử gần nhất: bộ nhớ 911 đạt, `test:db` (ai_gateway + contracts/ai + e2e) 728 đạt, hàng chờ 23 đạt.
Hội tụ (auditor) và rà soát hiến pháp toàn nhánh: 0 lỗi nghiêm trọng, không vi phạm nguyên tắc I–IX; VII đạt **có điều kiện** (xem dưới).

## Quyết định chính

- **Giữ chỗ**: một `UPDATE ai_budgets … WHERE used + reserved + est <= cap` + `INSERT ai_reservations` cùng giao dịch; `CHECK` của bảng là chốt chặn cuối. Trạng thái giữ chỗ
  `held → calling → settled | released`, mọi chuyển trạng thái là `UPDATE … WHERE state = :expected`. Race "dòng ngân sách chưa tồn tại" ở đầu chu kỳ đã sửa: khi `UPDATE` ra 0 hàng
  nhưng dòng đã được giao dịch khác tạo thì chạy lại đúng câu `UPDATE` một lần, không từ chối nhầm.
- **Quyết toán idempotent** nhờ `UPDATE ai_reservations … WHERE state IN (…) RETURNING`: chỉ khi trúng 1 dòng mới cộng `used` và ghi sổ (sổ `ai_cost_ledger` phân vùng theo tháng
  nên không có UNIQUE theo `reservation_id`). `used += min(cost, cap − used)`, phần vượt ghi `over_cap_micro_usd`.
- **Mốc 80%/100%**: cờ bật bằng `UPDATE … WHERE notified_x = false` trong cùng giao dịch quyết toán, thông báo qua `notifications.emit(tx, …)`. **Mốc 100% tính theo số đã quyết
  toán** (`cap − used <= minEstimate`, `minEstimate` = 1000 token vào + 500 ra theo giá `cheap_vision`), không tính phần giữ chỗ (tránh thông báo sai không sửa được); trạng
  thái "bị chặn" hiển thị trong `getUsage()` thì có tính giữ chỗ. `getUsage()` chỉ trả phần trăm làm tròn xuống, `state`, `nextCycleStartsAt`.
- **Chu kỳ tạm** theo ngày tạo tài khoản `active` (`AccountPublicApi.getAiCycleAnchor`; ngày 29–31 lùi về cuối tháng, giờ UTC+7); ghi ở "Theo dõi độ phức tạp" của plan.
- **Mã yêu cầu logic** `requestId` (quy ước `media:{mediaId}:label`): `AI_DUPLICATE_REQUEST` với `status: settled | in_progress`; `released` thì cho chạy lại.
- **Bảng giá/tuyến/cấu hình là dữ liệu**: `model_prices` chỉ-thêm (trigger chặn UPDATE/DELETE), quyết toán dùng `price_id` của giữ chỗ; ghi qua hàm `SECURITY DEFINER`
  `ai_gateway.admin_*` (0031, chỉ `support`; kiểm lệch ≤ 10× và `effective_from ≥ now + 60 s` nằm **trong SQL** sau khóa tư vấn, kiểm toán cùng giao dịch). Bể `system` không ghi
  bảng cấu hình (đã thu quyền ở 0030).
- **Dự phòng** theo `RouteBook.attemptsFor(task, tier)`: rank 2 chỉ khi tuyến bật **và** `task_fallback[task]` bật; mỗi lượt giữ chỗ riêng; đúng một lượt dự phòng. Lượt dự phòng
  thiếu giá/tuyến → bỏ lượt, `AI_PROVIDER_UNAVAILABLE` + `ai.price_missing`; lượt chính thiếu → `AI_NOT_CONFIGURED`. **Luồng đứt giữa chừng**: chưa có chữ thì dự phòng; **đã có chữ
  thì không tự dự phòng**, trả bản đã sinh kèm `interrupted`, quyết toán theo `partialUsage`/ước tính, sổ `missing_usage`.
- **Nhà cung cấp**: `AnthropicAdapter`, `OpenAiAdapter` (SDK ghim `@anthropic-ai/sdk` 1.7.0, `openai` 7.54.0; chỉ nhập ở `internal/providers/`, `check:boundaries` chặn nơi khác);
  không thử lại bên trong, lỗi chuẩn hóa `ProviderCallError` không giữ `cause` SDK, `x-trace-id` xuống nhà cung cấp, hủy trước khi gọi thì trả giữ chỗ. **Driver `real` cần đủ khóa cho
  mọi nhà cung cấp trong tuyến bật** (seed bật cả anthropic và openai). Anthropic **không có cờ không-huấn-luyện kỹ thuật** — chỉ cam kết hợp đồng; OpenAI gửi `store:false`.
- **STT**: ước tính `min(durationSec, 300)` làm tròn lên theo `billing_granularity_sec`; quyết toán theo thời lượng thực (`over_estimate` khi > 300 s, `missing_usage` khi nhà cung cấp
  không báo); `durationSec ≤ 0` → `AI_INVALID_REQUEST`; tải âm thanh chỉ `https`, host thuộc kho tệp hoặc `AI_STT_ALLOWED_HOSTS`, không theo chuyển hướng, trần 25 MB.
- **Giá bộ đệm Anthropic**: ghi bộ đệm = giá nhập × 1,25 (giả định chờ POC-1); đọc bộ đệm theo `cached_input_per_mtok`.
- **Ngân sách hệ thống** theo tuần UTC+7: trần = `countActiveIndustries()` × mức mỗi ngành (chụp lúc tạo dòng tuần); số ngành 0 hoặc thiếu nguồn → trần tạm
  `AI_SYSTEM_WEEKLY_CAP_MICRO_USD` + `ai.industry_source_missing`. Phân bổ chi phí xu hướng cho tài khoản cùng ngành (`allocate_trend_cost`) chia đều, dư gán 1 micro-USD cho mã nhỏ
  nhất, **không cộng vào `ai_budgets.used`**; mỗi tài khoản một giao dịch qua `runForAccount` (chỉ trong việc nền).
- **Cảnh báo**: bộ đếm `ai_gateway_events_total{event}` (tập nhãn cố định, khởi tạo bằng 0) cho các sự kiện `ai.*` chỉ có ở nhật ký; 10 quy tắc ở `ops/alerts/ai_gateway.rules.yml`.
  SC-013: `check_thresholds` chạy mỗi 5 phút (cửa sổ 10 phút, `for: 0m`, ≈ 11 phút); đối soát hóa đơn hằng ngày, tính ≤ 15 phút sau khi việc đối soát phát hiện lệch.
- **Thông điệp lỗi** hướng khách đều kèm hành động khắc phục (hiến pháp VI), không số tiền, không tên nhà cung cấp.

## Chạm tới

| Loại                               | Nội dung                                                                                                                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bảng (schema `ai_gateway`)         | tenant: `ai_budgets`, `ai_reservations`, `ai_trend_allocations`, `ai_cost_ledger` (phân vùng tháng, chỉ-thêm); shared: `system_budgets`, `system_reservations`, `system_cost_ledger`, `model_prices`, `model_routes`, `task_fallback`, `ai_settings`, `provider_invoices` |
| Migration                          | `0029` bảng, `0030` hạt giống **giả định** + quyền + 3 khung nhìn hỗ trợ, `0031` hàm quản trị, `0032` hàm tổng hợp/đối soát, `0033` `account.count_active_accounts()` + `open_reservations_count()`                                           |
| Khung nhìn hỗ trợ                  | `ai_gateway.support_ai_budget_detail`, `support_ai_cost_ledger`, `support_ai_trend_allocations` (không cột nội dung/bí mật)                                                                                                                   |
| Hàng chờ / việc                    | `ai_gateway.release_stale` (tenant, hẹn +15 phút 5 giây trong giao dịch giữ chỗ), `release_stale_system` (mỗi phút), `allocate_trend_cost` (queue `trends`), `check_thresholds` (`*/5 * * * *`), `reconcile_invoices` (02:00 `Asia/Ho_Chi_Minh`) |
| API                                | `POST/PUT /api/v1/admin/ai/{prices,settings,routes,task-fallback,provider-invoices}` (`ai.pricing.manage`, chỉ admin); `GET /support/ai/budget/:accountId?reason=…`, `GET /support/ai/summary?cycle=…` (`ai.cost.view`)                       |
| Quyền                              | `ai.pricing.manage` (admin), `ai.cost.view` (support, admin)                                                                                                                                                                                  |
| Module khác                        | `account` (`getAiCycleAnchor`, `countActiveAccounts`), `queue` (`runForAccount`), `notifications` (`ai_usage_80/100`); cổng đảo ngược `ACTIVE_INDUSTRIES_SOURCE`/`INDUSTRY_ACCOUNTS_SOURCE` chưa có bên hiện thực (module `trends`/`context`) |
| Cấu hình / bí mật                  | `AI_GATEWAY_DRIVER` (`fake`/`real`), `AI_PRICE_CACHE_TTL_MS` (≤ 60 000), `AI_TOKEN_ESTIMATE_SAFETY_PERCENT`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (Secret `api-secrets`/`worker-secrets`), `AI_STT_ALLOWED_HOSTS`, `AI_SYSTEM_WEEKLY_CAP_MICRO_USD` |
| Quan sát                           | `ai_gateway_{reserve_duration_ms,calls_total,fallback_total,blocked_total,estimate_ratio,open_reservations,events_total,provider_calls_total,provider_latency_ms}`                                                                              |
| Hạ tầng/CI                         | `ops/alerts/ai_gateway.rules.yml`; quy tắc ranh giới SDK (`tooling/boundaries/build-rules.cjs`); `handoff-map.mjs`; `ownership.json` mở rộng (`vitest*.mts`, `.dependency-cruiser.cjs`, `_journal.json`)                                      |

## Điểm cần biết khi sửa tiếp

- **Sửa trực tiếp `0030`/`0031`/`0032`/`0033` khi chưa phát hành là chủ ý** (nhánh chưa lên môi trường nào); môi trường đã áp bản cũ phải tạo lại CSDL.
- **Ngày UTC+7 cho chu kỳ và hệ thống theo tuần**; không đọc `app.account_id` trực tiếp, dùng `account.current_account_id()`; **không gọi Cổng AI bên trong `tenantTx`/`systemTx`** của bên gọi (kho ném lỗi lập trình).
- **Giá/mô hình ở `0030` là giả định** (sonnet-4-5, haiku-4-5, gpt-4.1, gpt-4.1-mini, whisper-1; mức ngành 1 000 000 micro-USD/tuần). Thay bằng dòng `model_prices` **mới** (bảng chỉ-thêm), không sửa dòng cũ.
- **`ReserveMeta.attempt`** chọn tuyến/giá của lượt (0 chính, 1 dự phòng); bản giả (`fake/store.*`) giữ nhãn `primary/fallback` và logic mốc 100% cũ — chủ ý, đây là công cụ dev/test; kho sandbox không lưu anomaly `missing_usage` (ràng buộc schema sandbox).
- **SC-009** chỉ đúng khi module `media` cắt 5 phút đầu trước khi gọi `transcribe` (FR-021 phía gọi); tệp dài hơn gửi cả tệp (≤ 25 MB) → `over_estimate`.
- Test cảnh báo `apps/server/test/unit/ai/alert-rules.spec.ts` đọc `ops/alerts/ai_gateway.rules.yml` và kiểu `GatewayEventName` ở `events.ts` (đừng đổi dạng literal); danh sách tên sự kiện ở `internal/event-names.ts` tránh vòng phụ thuộc với `metrics.ts`.
- Spec cần CSDL trong `test/ai_gateway/` đặt đuôi `.db.spec.ts` (cấu hình bộ nhớ loại sẵn); `test:db` cần `TEST_DATABASE_ADMIN_URL` (xem [run-tests](../howto/run-tests.md)). Cấu hình `vitest.queue.config.mts`/giới hạn kết nối: **không** `ALTER ROLE … CONNECTION LIMIT` trên vai trò dùng chung cả cụm (qa đã đổi sang giới hạn theo CSDL test).
- Ghi quản trị giá/cấu hình mới phải đi qua hàm `admin_*` hoặc owner; chưa có bề mặt khách cho `getUsage()` (thuộc module Tài khoản & Gói).
- Việc `release_stale` của tenant chỉ hẹn một lần cho mỗi giữ chỗ (cùng giao dịch giữ chỗ), không có lưới quét định kỳ; `AiOpenReservationsStuck` phát hiện giữ chỗ treo kéo dài.

## Điều kiện trước production

1. Cam kết hợp đồng **không-huấn-luyện** của Anthropic (không có cờ kỹ thuật) và OpenAI (`store:false`) có bằng chứng, đưa vào hồ sơ chuyển dữ liệu xuyên biên giới (Q-D3/C6); thêm hai nhà cung cấp vào bảng mục 9 (T049a).
2. Thay giá/mô hình giả định bằng giá thật sau POC-1/POC-3/POC-4 (T073a; hệ số ghi bộ đệm ×1,25 và tên trường usage của Anthropic, OpenAI nhận `audio.<đuôi>` — xem [open-questions](../open-questions.md)).
3. Đưa `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` vào Secret (`pnpm infra secrets set …`); cần **cả hai** khóa trừ khi tắt tuyến còn lại trong `model_routes`.
4. Nối hiện thực `ACTIVE_INDUSTRIES_SOURCE`/`INDUSTRY_ACCOUNTS_SOURCE` (module `trends`/`context`) và truyền `requestId` ở module `media` khi bật gán nhãn; kiểm SC-013 trên Prometheus thật.

## Nguồn

- specs/015-real-ai-gateway/spec.md, plan.md, research.md, data-model.md, tasks.md, acceptance-report.md, reviews/constitution-review.md
- specs/015-real-ai-gateway/contracts/ (ai-gateway-delta, provider-adapter, admin-ops, jobs-and-alerts)
- apps/server/drizzle/migrations/0029…0033\_\*.sql
- apps/server/docs/ai-gateway.md, ai-gateway-providers.md
- ops/alerts/ai_gateway.rules.yml
