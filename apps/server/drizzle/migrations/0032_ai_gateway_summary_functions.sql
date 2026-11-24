-- Migration tay 0032 (015 T068a, FR-018, FR-034, contracts/admin-ops.md mục 3): hàm TỔNG HỢP chỉ-đọc của Cổng AI.
-- Lý do: bể `support` chỉ đọc 3 khung nhìn theo tài khoản (0030) và bể `system` bị RLS theo tenant nên không tự tổng hợp
-- toàn hệ thống được. Theo mẫu 0031/0025: mỗi số liệu là MỘT hàm SECURITY DEFINER (search_path cố định, không SQL động,
-- EXECUTE chỉ vai trò đúng), trả CHỈ số tổng hợp – không mã tài khoản, không dữ liệu từng tài khoản nhận dạng được.
-- Chỉ THÊM hàm → tương thích ngược. Đảo ngược: DROP FUNCTION ba hàm dưới đây (không đụng dữ liệu).

-- 1) Tổng hợp chi phí theo chu kỳ cho nhân viên (`support`). `p_cycle` = ngày bắt đầu chu kỳ (khớp `ai_cost_ledger.cycle_start`).
--    Trả một dòng jsonb camelCase: { totalMicroUsd, accounts, averagePerAccountMicroUsd, averagePerPostMicroUsd,
--    byTask[{task,calls,costMicroUsd}], byProvider[{provider,calls,costMicroUsd}], byModel[{provider,modelId,calls,costMicroUsd}] }.
--    "accounts" = số tài khoản có phát sinh (chỉ là con số, không kèm mã). Trung bình làm tròn xuống số nguyên micro-USD;
--    trung bình mỗi bài = chi phí các dòng sổ `post_generation` (đã quyết toán) / số dòng đó. Không dữ liệu → toàn 0 và mảng rỗng.
CREATE OR REPLACE FUNCTION ai_gateway.admin_cost_summary(p_cycle date)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
  WITH l AS (
    SELECT task, provider, model_id, cost_micro_usd, account_id
      FROM ai_gateway.ai_cost_ledger
     WHERE cycle_start = p_cycle
  ),
  tot AS (
    SELECT coalesce(sum(cost_micro_usd), 0)::bigint AS total,
           count(DISTINCT account_id)::bigint AS accounts,
           coalesce(sum(cost_micro_usd) FILTER (WHERE task = 'post_generation'), 0)::bigint AS post_total,
           count(*) FILTER (WHERE task = 'post_generation')::bigint AS post_calls
      FROM l
  )
  SELECT jsonb_build_object(
    'totalMicroUsd', tot.total,
    'accounts', tot.accounts,
    'averagePerAccountMicroUsd', CASE WHEN tot.accounts = 0 THEN 0 ELSE tot.total / tot.accounts END,
    'averagePerPostMicroUsd', CASE WHEN tot.post_calls = 0 THEN 0 ELSE tot.post_total / tot.post_calls END,
    'byTask', coalesce((SELECT jsonb_agg(jsonb_build_object('task', g.task, 'calls', g.calls, 'costMicroUsd', g.cost)
                                         ORDER BY g.task)
                          FROM (SELECT task, count(*)::bigint AS calls, sum(cost_micro_usd)::bigint AS cost
                                  FROM l GROUP BY task) g), '[]'::jsonb),
    'byProvider', coalesce((SELECT jsonb_agg(jsonb_build_object('provider', g.provider, 'calls', g.calls, 'costMicroUsd', g.cost)
                                             ORDER BY g.provider)
                              FROM (SELECT provider, count(*)::bigint AS calls, sum(cost_micro_usd)::bigint AS cost
                                      FROM l GROUP BY provider) g), '[]'::jsonb),
    'byModel', coalesce((SELECT jsonb_agg(jsonb_build_object('provider', g.provider, 'modelId', g.model_id,
                                                             'calls', g.calls, 'costMicroUsd', g.cost)
                                          ORDER BY g.provider, g.model_id)
                           FROM (SELECT provider, model_id, count(*)::bigint AS calls, sum(cost_micro_usd)::bigint AS cost
                                   FROM l GROUP BY provider, model_id) g), '[]'::jsonb)
  )
  FROM tot
$$;
--> statement-breakpoint

-- 2) Tử số tỷ lệ tài khoản chạm ngưỡng mềm (việc `ai_gateway.check_thresholds`, vai trò `system`). Chỉ MỘT con số tổng hợp.
--    Hiến pháp IV: hàm CHỈ đọc bảng của `ai_gateway` (không đọc `account.accounts`). Mẫu số (tài khoản đang hoạt động) do bên
--    gọi lấy qua giao diện công khai của module Tài khoản. Tử số: số tài khoản (duy nhất) có dòng ngân sách chu kỳ HIỆN HÀNH
--    (cycle_start <= ngày UTC+7 của p_at < cycle_end) với used + reserved >= soft_limit; chu kỳ đã kết thúc không tính.
--    Xấp xỉ chấp nhận: chỉ tài khoản đã có ngân sách chu kỳ hiện hành mới được đếm.
CREATE OR REPLACE FUNCTION ai_gateway.threshold_ratio(p_at timestamptz)
  RETURNS TABLE (soft_accounts bigint)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
  WITH d AS (SELECT (p_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS today)
  SELECT count(DISTINCT b.account_id)::bigint
    FROM ai_gateway.ai_budgets b, d
   WHERE b.cycle_start <= d.today AND b.cycle_end > d.today
     AND b.used + b.reserved >= b.soft_limit
$$;
--> statement-breakpoint

-- 3) Đối soát hóa đơn (việc `ai_gateway.reconcile_invoices`, vai trò `system`): Σ chi phí sổ của một nhà cung cấp trong MỘT
--    NGÀY theo UTC+7 và hóa đơn tương ứng. Luôn trả đúng một dòng: invoice_total NULL + has_invoice = false khi chưa nhập hóa đơn.
--    Lọc theo khoảng thời gian (cắt tỉa phân vùng), không bọc cột trong hàm.
CREATE OR REPLACE FUNCTION ai_gateway.invoice_ledger_total(p_provider text, p_day date)
  RETURNS TABLE (ledger_total bigint, ledger_rows bigint, has_invoice boolean, invoice_total bigint)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
  SELECT (SELECT coalesce(sum(l.cost_micro_usd), 0)::bigint FROM ai_gateway.ai_cost_ledger l
           WHERE l.provider = p_provider
             AND l.created_at >= (p_day::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
             AND l.created_at < ((p_day + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')),
         (SELECT count(*)::bigint FROM ai_gateway.ai_cost_ledger l
           WHERE l.provider = p_provider
             AND l.created_at >= (p_day::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
             AND l.created_at < ((p_day + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')),
         EXISTS (SELECT 1 FROM ai_gateway.provider_invoices i WHERE i.provider = p_provider AND i.invoice_date = p_day),
         (SELECT i.total_micro_usd FROM ai_gateway.provider_invoices i
           WHERE i.provider = p_provider AND i.invoice_date = p_day)
$$;
--> statement-breakpoint

-- 4) Danh sách nhà cung cấp cần đối soát trong ngày: hợp của nhà cung cấp có dòng sổ và có hóa đơn ngày đó (UTC+7).
--    Chỉ trả tên nhà cung cấp (không dữ liệu tài khoản) để việc đối soát lặp qua `invoice_ledger_total`.
CREATE OR REPLACE FUNCTION ai_gateway.invoice_providers_for_day(p_day date)
  RETURNS TABLE (provider text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
  SELECT l.provider FROM ai_gateway.ai_cost_ledger l
   WHERE l.created_at >= (p_day::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
     AND l.created_at < ((p_day + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
  UNION
  SELECT i.provider FROM ai_gateway.provider_invoices i WHERE i.invoice_date = p_day
  ORDER BY 1
$$;
--> statement-breakpoint

-- ===== QUYỀN ================================================================================================================
REVOKE ALL ON FUNCTION ai_gateway.admin_cost_summary(date) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.threshold_ratio(timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.invoice_ledger_total(text, date) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.invoice_providers_for_day(date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.admin_cost_summary(date) TO "support";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.threshold_ratio(timestamptz) TO "system";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.invoice_ledger_total(text, date) TO "system";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.invoice_providers_for_day(date) TO "system";
