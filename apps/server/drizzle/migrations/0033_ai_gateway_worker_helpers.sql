-- Migration tay 0033 (015 T066/T068a): hai hàm tổng hợp chỉ-đọc cho Worker (vai trò `system`), theo mẫu 0031/0032.
-- Chỉ THÊM hàm → tương thích ngược. Đảo ngược: DROP FUNCTION hai hàm dưới đây (không đụng dữ liệu).

-- 1) Mẫu số của cảnh báo `ai.threshold_ratio_high`: số tài khoản đang hoạt động (status = 'active', chưa xóa).
--    Thuộc schema `account` (module Tài khoản sở hữu bảng; module bọc trong countActiveAccounts). `account.accounts` có RLS nên
--    vai trò `system` không tự đếm được; hàm chỉ trả MỘT con số, không lộ dòng nào.
CREATE OR REPLACE FUNCTION account.count_active_accounts()
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
  SELECT count(*)::bigint FROM account.accounts WHERE status = 'active' AND deleted_at IS NULL
$$;
--> statement-breakpoint

-- 2) Số giữ chỗ chưa đóng (state IN ('held','calling')) – nguồn cho gauge `ai_gateway_open_reservations` ở Worker.
--    Tổng toàn hệ thống, không theo tài khoản: tenant_open = ai_reservations, system_open = system_reservations.
CREATE OR REPLACE FUNCTION ai_gateway.open_reservations_count()
  RETURNS TABLE (tenant_open bigint, system_open bigint)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
  SELECT (SELECT count(*)::bigint FROM ai_gateway.ai_reservations WHERE state IN ('held', 'calling')),
         (SELECT count(*)::bigint FROM ai_gateway.system_reservations WHERE state IN ('held', 'calling'))
$$;
--> statement-breakpoint

-- ===== QUYỀN ================================================================================================================
REVOKE ALL ON FUNCTION account.count_active_accounts() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.open_reservations_count() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.count_active_accounts() TO "system";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.open_reservations_count() TO "system";
