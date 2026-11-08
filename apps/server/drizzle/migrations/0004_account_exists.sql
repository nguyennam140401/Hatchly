-- Migration tay 0004 (data-model mục 3, research R11): vai trò "support" kiểm tài khoản tồn tại khi
-- mở ngữ cảnh xem chi tiết mà KHÔNG có quyền đọc account.accounts – hàm chỉ trả đúng/sai.
CREATE OR REPLACE FUNCTION account.account_exists(p_id uuid) RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$ SELECT EXISTS (SELECT 1 FROM account.accounts WHERE id = p_id AND deleted_at IS NULL) $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.account_exists(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.account_exists(uuid) TO "support";
--> statement-breakpoint
-- USAGE để gọi current_account_id()/account_exists(); support KHÔNG có quyền trên bảng nào của account.
GRANT USAGE ON SCHEMA account TO "support";
