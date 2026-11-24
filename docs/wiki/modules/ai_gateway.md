---
type: module
title: Module ai_gateway (Cổng AI)
sources:
  [
    apps/server/src/modules/modules.manifest.json,
    apps/server/src/modules/ai_gateway/public-api.ts,
    apps/server/src/modules/ai_gateway/index.ts,
    apps/server/src/modules/ai_gateway/jobs.ts,
    apps/server/src/modules/ai_gateway/ai_gateway.module.ts,
    apps/server/src/modules/ai_gateway/internal/errors.ts,
    apps/server/src/modules/ai_gateway/internal/db/schema.ts,
    apps/server/docs/ai-gateway.md,
    apps/server/docs/ai-gateway-providers.md,
    apps/server/docs/gateways.md,
    specs/015-real-ai-gateway/plan.md,
    .specify/memory/architecture.md,
  ]
updated: 2026-11-24
status: current
related:
  [
    concepts/ai-budget.md,
    concepts/queues.md,
    concepts/tenant-rls.md,
    modules/notifications.md,
    modules/account.md,
    features/015-real-ai-gateway.md,
    features/005-gateway-contracts-fakes.md,
  ]
---

# ai_gateway – Cổng AI

## Trách nhiệm

Điểm duy nhất gọi AI và chuyển giọng nói (hiến pháp III): ước tính → giữ chỗ có điều kiện → đánh dấu đang gọi → gọi → quyết toán/trả lại; chọn bậc mô hình; chọn tuyến
chính/dự phòng; ghi sổ chi phí; quản trị bảng giá/tuyến/cấu hình; đối soát hóa đơn; ngân sách hệ thống theo tuần cho xu hướng. Kết quả/mức dùng cho khách chỉ có phần
trăm, không có tiền.

## Schema/bảng

Schema `ai_gateway` (migration `0029`–`0033`): tenant `ai_budgets`, `ai_reservations`, `ai_trend_allocations`, `ai_cost_ledger` (phân vùng tháng, chỉ-thêm); shared `system_budgets`,
`system_reservations`, `system_cost_ledger`, `model_prices` (chỉ-thêm), `model_routes`, `task_fallback`, `ai_settings`, `provider_invoices`. Ba khung nhìn hỗ trợ `support_ai_*`; hàm
`SECURITY DEFINER` `admin_*` (chỉ `support`) và hàm tổng hợp/Worker. Kho trong bộ nhớ/`sandbox` (`internal/fake/store.*`) vẫn có cho dev/test. Chi tiết:
[015](../features/015-real-ai-gateway.md).

## Giao diện công khai

`AiGatewayModule`, `AI_GATEWAY`, `AiGatewayPublicApi` (`generate`, `generateStream`, `transcribe`, `getUsage`), `AI_TASKS` (post_generation, topic_suggestion, image_labeling,
video_labeling, transcription, trend_summary), `MODEL_TIERS` (default, cheap, cheap_vision, stt), `AiError` (mã: `AI_BUDGET_EXHAUSTED`, `AI_SYSTEM_BUDGET_EXHAUSTED`,
`AI_PROVIDER_UNAVAILABLE`, `AI_NOT_CONFIGURED`, `AI_DUPLICATE_REQUEST`, `AI_INVALID_REQUEST`; `messageVi` luôn kèm hành động khắc phục), `noRetryOnAiError` (cho bộ xử lý nền), `fakeAi`,
`AI_FAKE_BUNDLE`; cổng đảo ngược `ACTIVE_INDUSTRIES_SOURCE`, `INDUSTRY_ACCOUNTS_SOURCE` (module khác cắm). `AiRequest`/`TranscribeRequest` có `requestId?` (`media:{mediaId}:label`).

## Việc nền

`ai_gateway.release_stale` (tenant, hẹn +15 phút 5 giây trong giao dịch giữ chỗ), `ai_gateway.release_stale_system` (mỗi phút), `ai_gateway.allocate_trend_cost` (queue `trends`),
`ai_gateway.check_thresholds` (mỗi 5 phút), `ai_gateway.reconcile_invoices` (02:00 giờ Việt Nam); phân vùng `ai_cost_ledger` đăng ký qua `registerPartitionedLog`.

## Phụ thuộc cho phép

`account` (`getAiCycleAnchor`, `countActiveAccounts`), `notifications`, `queue` (`runForAccount`, chỉ trong việc nền). SDK nhà cung cấp chỉ nhập ở `internal/providers/`.

## Chạy ở

api + worker. `AI_GATEWAY_DRIVER=fake` (mặc định dev/test; production từ chối) hoặc `real` (cần đủ khóa cho mọi nhà cung cấp trong tuyến bật). Giá/mô hình seed là giả định chờ
POC-1/POC-3/POC-4.

## Tính năng liên quan

[005](../features/005-gateway-contracts-fakes.md) (giao diện + bản giả), [015](../features/015-real-ai-gateway.md) (hiện thực thật).

## Nguồn

- apps/server/src/modules/ai_gateway/public-api.ts, jobs.ts, ai_gateway.module.ts, internal/errors.ts
- apps/server/docs/ai-gateway.md, ai-gateway-providers.md, gateways.md (mục 2)
- specs/015-real-ai-gateway/plan.md, data-model.md
