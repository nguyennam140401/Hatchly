-- Migration tay 0027 (010 T063, contracts/jobs-and-notifications.md mục 1.3): dọn trạng thái OAuth và phiên chọn Page đã dùng
-- hoặc hết hạn. Việc định kỳ chạy KHÔNG thuộc tài khoản nào nên không đọc/xóa được bảng có RLS; hàm SECURITY DEFINER này
-- CHỈ xóa (không trả dữ liệu khách hàng – chỉ số dòng đã xóa) cho vai trò `system` (Worker). Xóa HẲN, kể cả mã quyền đã mã
-- hóa của ứng viên trong `connect_selections.candidates`. Theo lô, chạy lại an toàn. Chỉ THÊM hàm → tương thích ngược.
CREATE OR REPLACE FUNCTION platform_gateway.purge_connect_data(
  p_batch_limit int DEFAULT 1000,
  p_now timestamptz DEFAULT now()
) RETURNS int
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, platform_gateway
AS $$
DECLARE
  v_states int;
  v_selections int;
BEGIN
  IF p_batch_limit <= 0 THEN
    RETURN 0;
  END IF;

  WITH doomed AS (
    SELECT id FROM platform_gateway.connect_states
     WHERE used_at IS NOT NULL OR expires_at < p_now - interval '1 hour'
     ORDER BY expires_at
     LIMIT p_batch_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM platform_gateway.connect_states s USING doomed WHERE s.id = doomed.id;
  GET DIAGNOSTICS v_states = ROW_COUNT;

  WITH doomed AS (
    SELECT id FROM platform_gateway.connect_selections
     WHERE used_at IS NOT NULL OR expires_at < p_now - interval '1 hour'
     ORDER BY expires_at
     LIMIT p_batch_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM platform_gateway.connect_selections s USING doomed WHERE s.id = doomed.id;
  GET DIAGNOSTICS v_selections = ROW_COUNT;

  RETURN v_states + v_selections;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_gateway.purge_connect_data(int, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_gateway.purge_connect_data(int, timestamptz) TO "system";
