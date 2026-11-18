-- Migration tay 0023 (014, research R7): liệt kê tài khoản cần dọn dẹp cho việc định kỳ `media.sweep`.
-- Bộ quét chạy KHÔNG thuộc tài khoản nào nên không đọc được bảng có RLS; hàm SECURITY DEFINER này CHỈ trả
-- DISTINCT mã tài khoản (không cột nghiệp vụ) cho vai trò `system` → không lộ dữ liệu khách hàng (Hiến pháp I).
-- Chỉ thêm hàm → tương thích ngược.
--   kind = 'stale_sessions' : tài khoản có phiên tải `open` đã quá `expires_at` (< cutoff)
--   kind = 'pending_purge'  : tài khoản có media đã xóa mềm (deleted_at < cutoff) mà tệp thật chưa được xóa
--   kind = 'full'           : mọi tài khoản có dữ liệu media (quét tuần: xóa hẳn > 30 ngày, tệp mồ côi, đối soát bộ đếm)
CREATE OR REPLACE FUNCTION media.list_cleanup_accounts(kind text, cutoff timestamptz, lim int)
  RETURNS SETOF uuid
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = media, pg_temp
AS $$
BEGIN
  IF lim IS NULL OR lim < 1 THEN
    RAISE EXCEPTION 'lim phải >= 1';
  END IF;
  IF kind = 'stale_sessions' THEN
    RETURN QUERY
      SELECT DISTINCT s.account_id
      FROM media.upload_sessions s
      WHERE s.state = 'open' AND s.expires_at < cutoff
      LIMIT lim;
  ELSIF kind = 'pending_purge' THEN
    RETURN QUERY
      SELECT DISTINCT m.account_id
      FROM media.media m
      WHERE m.deleted_at IS NOT NULL AND m.deleted_at < cutoff AND m.files_purged_at IS NULL
      LIMIT lim;
  ELSIF kind = 'full' THEN
    RETURN QUERY
      SELECT u.account_id FROM (
        SELECT account_id FROM media.storage_quotas
        UNION
        SELECT account_id FROM media.media
      ) u
      LIMIT lim;
  ELSE
    RAISE EXCEPTION 'kind không hợp lệ';
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION media.list_cleanup_accounts(text, timestamptz, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION media.list_cleanup_accounts(text, timestamptz, int) TO "system";
