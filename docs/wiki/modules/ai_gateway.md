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
    apps/server/docs/gateways.md,
    .specify/memory/architecture.md,
  ]
updated: 2026-11-14
status: draft
related: [concepts/ai-budget.md, concepts/queues.md, modules/notifications.md]
---

# ai_gateway – Cổng AI

## Trách nhiệm

Điểm duy nhất gọi AI và chuyển giọng nói (hiến pháp III): ước tính → giữ chỗ có điều kiện → gọi → quyết toán/trả lại;
chọn bậc mô hình; ghi sổ chi phí. Kết quả/mức dùng cho khách chỉ có phần trăm, không có tiền.

## Schema/bảng

Schema `ai_gateway`. Thiết kế: `ai_budgets`, `ai_cost_ledger`, `model_prices`. **Chưa có bảng/migration**: kho ngân
sách hiện là bản trong bộ nhớ / `sandbox` (`internal/fake/store.*`); bản thật là WBS 3.1.

## Giao diện công khai

`AiGatewayModule`, `AI_FAKE_BUNDLE`, `AI_GATEWAY`, `AiGatewayPublicApi` (`generate`, `generateStream`, `transcribe`,
`getUsage`), `AI_TASKS` (post_generation, topic_suggestion, image_labeling, video_labeling, transcription,
trend_summary), `MODEL_TIERS` (default, cheap, cheap_vision, stt), `AiError`, `fakeAi`. Loại việc
`ai_gateway.release_stale` (tenant) và `ai_gateway.release_stale_system` (mỗi phút) ở `jobs.ts`.

## Phụ thuộc cho phép

`account`, `notifications`, `queue`.

## Chạy ở

api + worker. `AI_GATEWAY_DRIVER` hiện chỉ `fake`; chưa chọn nhà cung cấp (chờ POC-1/POC-4).

## Tính năng liên quan

[005](../features/005-gateway-contracts-fakes.md).

## Nguồn

- apps/server/src/modules/ai_gateway/public-api.ts
- apps/server/src/modules/ai_gateway/jobs.ts
- apps/server/docs/gateways.md (mục 2)
