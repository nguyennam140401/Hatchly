-- Migration tay 0030 (015, T007, data-model.md mục 3, 4): quyền vai trò cho bảng Cổng AI, dữ liệu cấu hình khởi đầu
-- (GIÁ GIẢ ĐỊNH, thay bằng giá thật sau POC-1/POC-4 bằng dòng `model_prices` mới) và khung nhìn hỗ trợ.
-- Chỉ thêm → tương thích ngược (API, Worker cũ không chạm schema ai_gateway mới).

-- 1) Quyền. Quyền mặc định của schema cấp đủ DML cho app/system trên bảng mới → thu hồi tường minh (khuôn 0020).
--    Cấu hình dùng chung (quyền tối thiểu): `app` và `system` (Worker) chỉ ĐỌC; việc ghi do quản trị nội bộ qua đường
--    hàm SECURITY DEFINER hẹp `ai_gateway.admin_*` (migration 0031, chỉ cấp cho `support`), mọi thay đổi ghi `audit_log`. `model_prices` chỉ-thêm (trigger ở 0029 chặn UPDATE/DELETE).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ai_gateway.model_prices, ai_gateway.model_routes,
  ai_gateway.task_fallback, ai_gateway.ai_settings FROM "app", "system";
--> statement-breakpoint
-- Hóa đơn nhà cung cấp: Worker chỉ đọc để đối soát; vận hành nhập qua hàm `ai_gateway.admin_enter_invoice` (0031).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ai_gateway.provider_invoices FROM "system";
--> statement-breakpoint
-- Ngân sách/giữ chỗ/sổ hệ thống, hóa đơn nhà cung cấp, phân bổ xu hướng: chỉ `system`; khách không đọc được.
REVOKE ALL ON ai_gateway.system_budgets, ai_gateway.system_reservations, ai_gateway.system_cost_ledger,
  ai_gateway.provider_invoices, ai_gateway.ai_trend_allocations FROM "app";
--> statement-breakpoint

-- 2) Dữ liệu khởi đầu (ON CONFLICT DO NOTHING → chạy lại không đổi kết quả).
--
-- !!! CẢNH BÁO: DỮ LIỆU GIẢ ĐỊNH, KHÔNG DÙNG CHO PRODUCTION !!!
--    Giá mô hình (`model_prices`, effective_from 2026-01-01), mã mô hình và các tuyến `model_routes` (đang bật) bên dưới
--    chỉ là giả định để phát triển/kiểm thử, đang chờ kết quả POC-1 (mô hình AI), POC-3 (ngân sách xu hướng) và
--    POC-4 (chuyển giọng nói). Chưa bật `AI_GATEWAY_DRIVER=real` ở production trước khi các POC chốt.
--    Khi có giá thật: THÊM dòng `model_prices` mới (bảng chỉ-thêm, trigger chặn UPDATE/DELETE) với `effective_from`
--    đúng ngày hiệu lực; KHÔNG sửa hay xóa dòng cũ. Đổi tuyến/tắt tuyến qua `ai_gateway.admin_set_route` (0031, có ghi `audit_log`).
--    Trần 4 USD, ngưỡng mềm 2 USD; mức USD mỗi ngành mỗi tuần: 1 USD (SA chốt tạm, POC-3 sẽ chỉnh).
INSERT INTO ai_gateway.ai_settings
  (id, account_cap_micro_usd, account_soft_limit_micro_usd, per_industry_weekly_micro_usd, updated_by)
VALUES (1, 4000000, 2000000, 1000000, 'migration-015')
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- Dự phòng theo loại việc (FR-024a): chỉ bài viết và gợi ý chủ đề bật; gán nhãn, STT, tóm tắt xu hướng tắt.
INSERT INTO ai_gateway.task_fallback (task, enabled, updated_by) VALUES
  ('post_generation', true, 'migration-015'),
  ('topic_suggestion', true, 'migration-015'),
  ('image_labeling', false, 'migration-015'),
  ('video_labeling', false, 'migration-015'),
  ('transcription', false, 'migration-015'),
  ('trend_summary', false, 'migration-015')
ON CONFLICT (task) DO NOTHING;
--> statement-breakpoint
-- Giá GIẢ ĐỊNH (micro-USD / 1 000 000 token; STT micro-USD / phút âm thanh). Mã mô hình cũng là giả định.
INSERT INTO ai_gateway.model_prices
  (id, provider, model_id, unit, input_per_mtok, output_per_mtok, cached_input_per_mtok, per_minute,
   billing_granularity_sec, effective_from, created_by)
VALUES
  ('0194f100-0000-7000-8000-000000000001', 'anthropic', 'claude-sonnet-4-5', 'token', 3000000, 15000000, 300000, NULL, 1, '2026-01-01 00:00:00+00', 'migration-015'),
  ('0194f100-0000-7000-8000-000000000002', 'anthropic', 'claude-haiku-4-5', 'token', 1000000, 5000000, 100000, NULL, 1, '2026-01-01 00:00:00+00', 'migration-015'),
  ('0194f100-0000-7000-8000-000000000003', 'openai', 'gpt-4.1', 'token', 2000000, 8000000, 500000, NULL, 1, '2026-01-01 00:00:00+00', 'migration-015'),
  ('0194f100-0000-7000-8000-000000000004', 'openai', 'gpt-4.1-mini', 'token', 400000, 1600000, 100000, NULL, 1, '2026-01-01 00:00:00+00', 'migration-015'),
  ('0194f100-0000-7000-8000-000000000005', 'openai', 'whisper-1', 'audio_minute', NULL, NULL, NULL, 6000, 1, '2026-01-01 00:00:00+00', 'migration-015')
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- Định tuyến 4 bậc: chính = Anthropic (default/cheap/cheap_vision), dự phòng = OpenAI; STT chỉ OpenAI, chưa có dự phòng.
INSERT INTO ai_gateway.model_routes (tier, rank, provider, model_id, enabled, updated_by) VALUES
  ('default', 1, 'anthropic', 'claude-sonnet-4-5', true, 'migration-015'),
  ('default', 2, 'openai', 'gpt-4.1', true, 'migration-015'),
  ('cheap', 1, 'anthropic', 'claude-haiku-4-5', true, 'migration-015'),
  ('cheap', 2, 'openai', 'gpt-4.1-mini', true, 'migration-015'),
  ('cheap_vision', 1, 'anthropic', 'claude-haiku-4-5', true, 'migration-015'),
  ('cheap_vision', 2, 'openai', 'gpt-4.1-mini', true, 'migration-015'),
  ('stt', 1, 'openai', 'whisper-1', true, 'migration-015')
ON CONFLICT (tier, rank) DO NOTHING;
--> statement-breakpoint

-- 3) Khung nhìn hỗ trợ (quy tắc i): không có lời nhắc, văn bản kết quả hay mã bí mật (bảng vốn không lưu). Do "owner" sở
--    hữu nên đọc vượt RLS → CHỈ cấp cho support, lọc tường minh theo ngữ cảnh tenant (supportViewAccount đặt biến
--    phiên). Mọi truy vấn được ghi `support.view_account` kèm lý do ở tầng ứng dụng. Đặt trong schema `ai_gateway`
--    (như `platform_gateway.support_channel_view`): schema `support` riêng chưa có trong tệp kê khai module.
CREATE VIEW ai_gateway.support_ai_budget_detail AS
  SELECT id, account_id, cycle_start, cycle_end, used, reserved, cap, soft_limit, notified_80, notified_100, updated_at
    FROM ai_gateway.ai_budgets
   WHERE account_id = account.current_account_id();
--> statement-breakpoint
CREATE VIEW ai_gateway.support_ai_cost_ledger AS
  SELECT id, account_id, cycle_start, reservation_id, request_id, task, model_tier, model_id, provider,
         input_tokens, output_tokens, cached_input_tokens, audio_seconds, cost_micro_usd, estimate_micro_usd,
         anomaly, over_cap_micro_usd, trace_id, created_at
    FROM ai_gateway.ai_cost_ledger
   WHERE account_id = account.current_account_id();
--> statement-breakpoint
CREATE VIEW ai_gateway.support_ai_trend_allocations AS
  SELECT id, account_id, week_start, industry_id, cost_micro_usd, shared_ledger_id, created_at
    FROM ai_gateway.ai_trend_allocations
   WHERE account_id = account.current_account_id();
--> statement-breakpoint
-- Quyền mặc định của schema cấp SELECT cho app/system trên đối tượng mới → thu hồi (khung nhìn đọc vượt RLS chỉ cho support).
REVOKE ALL ON ai_gateway.support_ai_budget_detail, ai_gateway.support_ai_cost_ledger,
  ai_gateway.support_ai_trend_allocations FROM "app", "system";
--> statement-breakpoint
GRANT USAGE ON SCHEMA ai_gateway TO "support";
--> statement-breakpoint
GRANT SELECT ON ai_gateway.support_ai_budget_detail, ai_gateway.support_ai_cost_ledger,
  ai_gateway.support_ai_trend_allocations TO "support";
