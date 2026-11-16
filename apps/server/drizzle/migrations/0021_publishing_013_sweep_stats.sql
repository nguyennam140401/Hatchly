-- Migration tay 0021 (013, research R14): số liệu tổng hợp cho việc định kỳ `publishing.sweep_overdue`.
-- Bộ quét chạy KHÔNG thuộc tài khoản nào nên không đọc được bảng có RLS; hàm SECURITY DEFINER này CHỈ trả bốn con số
-- tổng hợp (không dòng, không mã tài khoản) cho vai trò `system` → không lộ dữ liệu khách hàng (Hiến pháp I).
-- Chỉ thêm hàm → tương thích ngược.
CREATE OR REPLACE FUNCTION publishing.sweep_stats(overdue_after_sec int DEFAULT 300)
  RETURNS TABLE (
    overdue_scheduled bigint,
    retry_wait bigint,
    unknown bigint,
    needs_check bigint
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, publishing
AS $$
  SELECT
    count(*) FILTER (WHERE status = 'scheduled' AND scheduled_at < now() - make_interval(secs => overdue_after_sec)),
    count(*) FILTER (WHERE status = 'retry_wait'),
    count(*) FILTER (WHERE status = 'unknown'),
    count(*) FILTER (WHERE status = 'needs_check')
  FROM publishing.publish_attempts
  WHERE status IN ('scheduled', 'retry_wait', 'unknown', 'needs_check')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION publishing.sweep_stats(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION publishing.sweep_stats(int) TO "system";
