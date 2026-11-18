-- Migration tay 0023 (010, data-model.md mục 1, 5, 6; contracts/jobs-and-notifications.md mục 1.1, 4):
-- quyền, dữ liệu gốc `gateway_settings`, hàm SECURITY DEFINER cho việc nền và khung nhìn hỗ trợ của bảng ở 0022.
-- Chỉ thêm / chỉ thu hồi quyền trên bảng MỚI → tương thích ngược (API, Worker cũ không chạm bảng mới).

-- 1) Nhật ký đổi công tắc là CHỈ THÊM: thu hồi UPDATE, DELETE của vai trò ứng dụng (dòng chỉ mất theo CASCADE khi
--    tài khoản bị xóa hẳn – khóa ngoại cascade chạy với quyền của chủ bảng).
REVOKE UPDATE, DELETE ON platform_gateway.feature_override_events FROM "app", "system";
--> statement-breakpoint

-- 2) Cấu hình dùng chung: dòng gốc do migration nạp; ứng dụng chỉ SỬA giá trị (features.service, có kiểm toán),
--    không thêm/xóa khóa.
REVOKE INSERT, DELETE ON platform_gateway.gateway_settings FROM "app", "system";
--> statement-breakpoint
INSERT INTO platform_gateway.gateway_settings (key, value) VALUES
  ('channel.tiktok.enabled_default', 'false'::jsonb),
  ('channel.max_per_platform', '5'::jsonb),
  ('channel.expiry_warn_days', '7'::jsonb),
  ('channel.manual_check_cooldown_sec', '20'::jsonb),
  ('channel.selection_ttl_sec', '600'::jsonb),
  ('channel.check_batch_limit', '500'::jsonb)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

-- 3) Danh sách kết nối đến hạn kiểm tra/làm mới. Việc định kỳ chạy KHÔNG thuộc tài khoản nào nên không đọc được
--    bảng có RLS; hàm này CHỈ trả `(account_id, connection_id)` – không mã quyền, không tên, không bản mã – cho
--    vai trò `system` (Worker), nên không lộ dữ liệu khách hàng (Hiến pháp I). Điều kiện "đến hạn" đúng mục 1.1:
--    (a) active chưa kiểm tra > 20 giờ; (b) active sắp hết hạn (< warn_days + 1 ngày); (c) recheck_required;
--    (d) TikTok có lần kiểm tra cũ hơn lần đổi mặc định công tắc. `needs_reconnect` thuần KHÔNG quét lại hằng ngày.
CREATE OR REPLACE FUNCTION platform_gateway.list_due_connections(
  p_batch_limit int,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE (account_id uuid, connection_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, platform_gateway
AS $$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (value #>> '{}')::int FROM platform_gateway.gateway_settings
                 WHERE key = 'channel.expiry_warn_days'), 7) AS warn_days,
      (SELECT updated_at FROM platform_gateway.gateway_settings
        WHERE key = 'channel.tiktok.enabled_default') AS tiktok_default_changed_at
  )
  SELECT c.account_id, c.id
    FROM platform_gateway.channel_connections c, cfg
   WHERE p_batch_limit > 0
     AND c.status <> 'disconnected'
     AND (
       (c.status = 'active' AND (c.last_checked_at IS NULL OR c.last_checked_at < p_now - interval '20 hours'))
       OR (c.status = 'active' AND c.token_expires_at IS NOT NULL
           AND c.token_expires_at < p_now + make_interval(days => cfg.warn_days + 1))
       OR c.recheck_required
       OR (c.channel_type = 'tiktok' AND c.status = 'active'
           AND cfg.tiktok_default_changed_at IS NOT NULL
           AND (c.last_checked_at IS NULL OR c.last_checked_at < cfg.tiktok_default_changed_at))
     )
   ORDER BY c.last_checked_at ASC NULLS FIRST, c.id
   LIMIT p_batch_limit
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_gateway.list_due_connections(int, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_gateway.list_due_connections(int, timestamptz) TO "system";
--> statement-breakpoint

-- 4) Số liệu tổng hợp cho chỉ số OpenTelemetry (`channel_connections{state,channel_type}`, `channel_expiring_lt7d`):
--    chỉ số đếm theo loại kênh × trạng thái lưu, không dòng, không mã tài khoản (cùng mẫu publishing.sweep_stats).
CREATE OR REPLACE FUNCTION platform_gateway.channel_stats()
  RETURNS TABLE (channel_type text, status text, total bigint, expiring_lt7d bigint)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, platform_gateway
AS $$
  SELECT c.channel_type, c.status, count(*),
         count(*) FILTER (WHERE c.status = 'active' AND c.token_expires_at IS NOT NULL
                            AND c.token_expires_at < now() + interval '7 days')
    FROM platform_gateway.channel_connections c
   GROUP BY c.channel_type, c.status
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_gateway.channel_stats() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_gateway.channel_stats() TO "system";
--> statement-breakpoint

-- 5) Khung nhìn hỗ trợ (quy tắc i): KHÔNG có cột `*_ciphertext`, `granted_scopes`. Do "owner" sở hữu nên đọc vượt
--    RLS → CHỈ cấp cho support, và lọc tường minh theo ngữ cảnh tenant (supportViewAccount đặt biến phiên).
--    Mọi truy vấn qua khung nhìn này được ghi `support.view_channel` ở tầng ứng dụng (FR-030).
CREATE VIEW platform_gateway.support_channel_view AS
  SELECT id, account_id, channel_type, display_name, status AS state, token_expires_at, expiry_kind,
         last_checked_at, last_error_code, connected_at
    FROM platform_gateway.channel_connections
   WHERE account_id = account.current_account_id();
--> statement-breakpoint
GRANT USAGE ON SCHEMA platform_gateway TO "support";
--> statement-breakpoint
GRANT SELECT ON platform_gateway.support_channel_view TO "support";
