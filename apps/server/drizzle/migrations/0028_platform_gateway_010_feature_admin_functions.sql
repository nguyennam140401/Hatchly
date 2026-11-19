-- Migration tay 0028 (010 T081, contracts/feature-flags.md mục 5): đổi công tắc tính năng của khách hàng bởi nhân viên nội bộ.
-- Mỗi lần đổi là MỘT hàm SECURITY DEFINER (một giao dịch, atomic): (1) upsert/xóa `feature_overrides` hoặc cập nhật `gateway_settings`,
-- (2) chèn `feature_override_events` (chỉ thêm), (3) ghi `infra.audit_log` `feature.set` (metadata chỉ flag/old/new/reason_len),
-- (4) khi đổi ghi đè: đặt `recheck_required = true` cho kết nối TikTok của tài khoản đó. Chạy với vai trò `support`/`system`, KHÔNG
-- cần BYPASSRLS và không cần ngữ cảnh tenant của bất kỳ khách hàng nào. Chỉ THÊM hàm → tương thích ngược.

CREATE OR REPLACE FUNCTION platform_gateway.set_feature_override(
  p_account uuid,
  p_flag text,
  p_value text,
  p_staff uuid,
  p_actor_type text,
  p_reason text,
  p_trace text,
  p_row_id uuid,
  p_event_id uuid
) RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, platform_gateway
AS $$
DECLARE
  v_cur boolean;
  v_old text;
BEGIN
  IF p_flag NOT IN ('channel.tiktok') THEN
    RAISE EXCEPTION 'FEATURE_UNKNOWN_FLAG' USING ERRCODE = '22023';
  END IF;
  IF p_value NOT IN ('on', 'off', 'default') THEN
    RAISE EXCEPTION 'FEATURE_BAD_VALUE' USING ERRCODE = '22023';
  END IF;
  IF p_actor_type NOT IN ('support', 'admin') THEN
    RAISE EXCEPTION 'FEATURE_BAD_ACTOR' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(p_reason, '')) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'FEATURE_BAD_REASON' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM account.accounts WHERE id = p_account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FEATURE_ACCOUNT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT o.value INTO v_cur FROM platform_gateway.feature_overrides o
   WHERE o.account_id = p_account AND o.flag_key = p_flag
   FOR UPDATE;
  v_old := CASE WHEN NOT FOUND THEN 'default' WHEN v_cur THEN 'on' ELSE 'off' END;

  IF p_value = 'default' THEN
    DELETE FROM platform_gateway.feature_overrides WHERE account_id = p_account AND flag_key = p_flag;
  ELSE
    INSERT INTO platform_gateway.feature_overrides (id, account_id, flag_key, value, reason, changed_by_staff_id)
    VALUES (p_row_id, p_account, p_flag, p_value = 'on', p_reason, p_staff)
    ON CONFLICT (account_id, flag_key) DO UPDATE
      SET value = EXCLUDED.value, reason = EXCLUDED.reason,
          changed_by_staff_id = EXCLUDED.changed_by_staff_id, updated_at = now();
  END IF;

  INSERT INTO platform_gateway.feature_override_events
    (id, account_id, flag_key, old_value, new_value, reason, changed_by_staff_id, trace_id)
  VALUES (p_event_id, p_account, p_flag, v_old, p_value, p_reason, p_staff, coalesce(p_trace, ''));

  INSERT INTO infra.audit_log (id, account_id, actor_type, actor_id, action, trace_id, metadata)
  VALUES (p_event_id, p_account, p_actor_type, p_staff::text, 'feature.set', p_trace,
          jsonb_build_object('flag', p_flag, 'old', v_old, 'new', p_value,
                             'reason_len', char_length(p_reason)));

  -- Bật lại ⇒ kiểm tra lại từng kết nối TikTok của tài khoản (cùng giao dịch); đã ngắt thì thôi.
  IF p_flag = 'channel.tiktok' THEN
    UPDATE platform_gateway.channel_connections
       SET recheck_required = true
     WHERE account_id = p_account AND channel_type = 'tiktok' AND status <> 'disconnected';
  END IF;
  RETURN v_old;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION platform_gateway.set_feature_default(
  p_flag text,
  p_value boolean,
  p_staff uuid,
  p_actor_type text,
  p_reason text,
  p_trace text,
  p_event_id uuid
) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, platform_gateway
AS $$
DECLARE
  v_key text;
  v_old jsonb;
BEGIN
  IF p_flag NOT IN ('channel.tiktok') THEN
    RAISE EXCEPTION 'FEATURE_UNKNOWN_FLAG' USING ERRCODE = '22023';
  END IF;
  IF p_actor_type NOT IN ('support', 'admin') THEN
    RAISE EXCEPTION 'FEATURE_BAD_ACTOR' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(p_reason, '')) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'FEATURE_BAD_REASON' USING ERRCODE = '22023';
  END IF;
  v_key := p_flag || '.enabled_default';
  SELECT value INTO v_old FROM platform_gateway.gateway_settings WHERE key = v_key FOR UPDATE;
  UPDATE platform_gateway.gateway_settings
     SET value = to_jsonb(p_value), updated_at = now(), updated_by = p_staff
   WHERE key = v_key;
  INSERT INTO infra.audit_log (id, account_id, actor_type, actor_id, action, trace_id, metadata)
  VALUES (p_event_id, NULL, p_actor_type, p_staff::text, 'feature.set', p_trace,
          jsonb_build_object('flag', p_flag, 'scope', 'default', 'old', coalesce(v_old #>> '{}', 'false'),
                             'new', p_value::text, 'reason_len', char_length(p_reason)));
  RETURN coalesce((v_old #>> '{}')::boolean, false);
END
$$;
--> statement-breakpoint
-- Đọc (chỉ-đọc) cho màn hình/lệnh nhân viên: giá trị mặc định và ghi đè của MỘT tài khoản – không lộ dữ liệu khác.
CREATE OR REPLACE FUNCTION platform_gateway.get_feature_state(p_account uuid, p_flag text)
  RETURNS TABLE (default_enabled boolean, override_value text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, platform_gateway
AS $$
  SELECT coalesce((SELECT (s.value #>> '{}')::boolean FROM platform_gateway.gateway_settings s
                    WHERE s.key = p_flag || '.enabled_default'), false),
         (SELECT CASE WHEN o.value THEN 'on' ELSE 'off' END FROM platform_gateway.feature_overrides o
           WHERE o.account_id = p_account AND o.flag_key = p_flag)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_gateway.set_feature_override(uuid, text, text, uuid, text, text, text, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_gateway.set_feature_default(text, boolean, uuid, text, text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_gateway.get_feature_state(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_gateway.set_feature_override(uuid, text, text, uuid, text, text, text, uuid, uuid) TO "support", "system";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_gateway.set_feature_default(text, boolean, uuid, text, text, text, uuid) TO "support", "system";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_gateway.get_feature_state(uuid, text) TO "support", "system";
