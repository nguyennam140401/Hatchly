---
type: concept
title: Ngân sách AI và Cổng AI
sources:
  [
    .specify/memory/constitution.md,
    .specify/memory/architecture.md,
    TaiLieuDacTa/ADD_Module_Cong_AI.md,
    apps/server/docs/gateways.md,
    apps/server/src/modules/ai_gateway/public-api.ts,
    apps/server/src/modules/ai_gateway/jobs.ts,
  ]
updated: 2026-11-14
status: draft
related: [modules/ai_gateway.md, concepts/queues.md, decisions/index.md]
---

# Ngân sách AI (hiến pháp III, ADR-06)

**Hiện thực (005)**: giao diện `AiGatewayPublicApi` + bản giả (`fakeAi`) mô phỏng giữ chỗ/quyết toán, kiểu
`AI_TASKS`/`MODEL_TIERS`, việc trả giữ chỗ treo (`ai_gateway.release_stale` sau 15 phút, `..._system` mỗi phút).
**Chưa hiện thực**: bảng `ai_budgets`, `ai_cost_ledger`, `model_prices`, nhà cung cấp thật (chờ POC-1/POC-4), đối soát hóa đơn.

Thiết kế:

- Mọi lời gọi AI/chuyển giọng nói đi qua Cổng AI; module khác không nhập SDK nhà cung cấp (`check:boundaries` bắt theo
  `aiProviderPackagePatterns` trong manifest).
- Trước lời gọi: giữ chỗ theo chi phí tối đa ước tính bằng UPDATE có điều kiện (không đủ -> chặn); sau: quyết toán thật,
  trả phần dư; lỗi/hết giờ trả lại. Trạng thái giữ chỗ: held -> calling -> settled | released.
- Mục tiêu ≤ 2 USD, trần cứng 4 USD/tài khoản/chu kỳ: từ 2 USD tự chuyển mô hình rẻ; từ 4 USD chặn AI, vẫn soạn/duyệt/đăng
  tay được. Tiền là số nguyên micro-USD; bảng giá là cấu hình; kiểm tra ngân sách ≤ 50 ms; không cache.
- **Khách không bao giờ thấy số tiền**: chỉ phần trăm trên trần (`AiUsage`, FR-12).

## Nguồn

- .specify/memory/constitution.md (nguyên tắc III)
- apps/server/docs/gateways.md (mục 2)
- TaiLieuDacTa/ADD_Module_Cong_AI.md
