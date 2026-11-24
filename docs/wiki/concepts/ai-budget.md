---
type: concept
title: Ngân sách AI và Cổng AI
sources:
  [
    .specify/memory/constitution.md,
    .specify/memory/architecture.md,
    TaiLieuDacTa/ADD_Module_Cong_AI.md,
    apps/server/docs/gateways.md,
    apps/server/docs/ai-gateway.md,
    apps/server/src/modules/ai_gateway/public-api.ts,
    apps/server/src/modules/ai_gateway/jobs.ts,
    specs/015-real-ai-gateway/plan.md,
    specs/015-real-ai-gateway/data-model.md,
  ]
updated: 2026-11-24
status: current
related:
  [modules/ai_gateway.md, concepts/queues.md, decisions/index.md, features/015-real-ai-gateway.md]
---

# Ngân sách AI (hiến pháp III, ADR-06)

**Hiện thực (005 + 015)**: giao diện `AiGatewayPublicApi`; bản giả (`fakeAi`) cho dev/test; kho **thật trong PostgreSQL** (015): `ai_budgets`, `ai_reservations`, `ai_cost_ledger`,
`model_prices`, `model_routes`, `ai_settings`; hai bộ chuyển đổi nhà cung cấp (Anthropic, OpenAI) sau giao diện nội bộ; dọn giữ chỗ treo; đối soát hóa đơn. Nhà cung cấp/giá thật vẫn **chờ POC-1/POC-3/POC-4**.

- Mọi lời gọi AI/chuyển giọng nói đi qua Cổng AI; module khác không nhập SDK nhà cung cấp (`check:boundaries`, quy tắc `ai-sdk-only-in-ai-gateway`: chỉ `ai_gateway/internal/providers/`).
- **Trước** lời gọi: giữ chỗ theo chi phí tối đa ước tính bằng **một UPDATE có điều kiện** (`used + reserved + est <= cap`; không đủ → chặn, 0 lời gọi nhà cung cấp); **sau**: quyết toán
  thật, trả phần dư; lỗi/hết giờ/hủy trả lại. Trạng thái giữ chỗ `held → calling → settled | released`; quyết toán idempotent. Giữ chỗ treo được dọn sau 15 phút.
- Trần mặc định 4 USD/tài khoản/chu kỳ (4 000 000 micro-USD), ngưỡng mềm 2 USD đổi sang mô hình rẻ, đọc từ `ai_settings` và **chụp vào dòng ngân sách** lúc tạo; từ trần chặn AI nhưng vẫn
  soạn/duyệt/đăng tay. Tiền là số nguyên micro-USD; bảng giá là cấu hình chỉ-thêm (cache ≤ 60 giây); kiểm tra ngân sách ≤ 50 ms; **không cache ngân sách**.
- Chu kỳ tạm theo ngày tạo tài khoản `active` (ngày 29–31 lùi về cuối tháng, UTC+7). Mốc 80%/100% phát đúng một thông báo mỗi chu kỳ trong cùng giao dịch quyết toán; **100% tính theo số đã
  quyết toán**.
- Ngân sách hệ thống theo tuần cho xu hướng (`system_budgets`), phân bổ chi phí cho tài khoản cùng ngành, **không cộng vào `used` của khách**.
- **Khách không bao giờ thấy số tiền**: chỉ phần trăm làm tròn xuống trên trần (`AiUsage`, FR-12); thông điệp lỗi kèm hành động khắc phục; hỗ trợ xem chi phí từng tài khoản qua khung nhìn `support_ai_*` với lý do và kiểm toán.

## Nguồn

- .specify/memory/constitution.md (nguyên tắc III)
- apps/server/docs/ai-gateway.md, gateways.md (mục 2)
- specs/015-real-ai-gateway/plan.md, data-model.md
- TaiLieuDacTa/ADD_Module_Cong_AI.md
