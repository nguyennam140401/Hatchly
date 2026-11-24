-- Migration tay 0031 (015 T039a, contracts/admin-ops.md mục 2, FR-019a): quản trị cấu hình Cổng AI bởi admin nội bộ.
-- Lý do: tiến trình API KHÔNG có quyền ghi `model_prices`, `model_routes`, `task_fallback`, `ai_settings`, `provider_invoices`
-- (0030 thu quyền `app`; bể `system` chỉ ở Worker; `support` chỉ đọc 3 khung nhìn). Theo tiền lệ 0028: mỗi thay đổi là MỘT hàm
-- SECURITY DEFINER (search_path cố định, EXECUTE chỉ `support`) ghi cấu hình VÀ `infra.audit_log` trong CÙNG giao dịch
-- (kiểm toán lỗi → hoàn tác cả cấu hình). Chạy qua `supportCommand` (không BYPASSRLS, không ngữ cảnh tenant).
-- Chỉ THÊM hàm → tương thích ngược. Đảo ngược: DROP FUNCTION các hàm dưới đây (không đụng dữ liệu).
--
-- Mã lỗi nghiệp vụ: RAISE EXCEPTION với MESSAGE = mã (AI_PRICE_IMPLAUSIBLE | AI_PRICE_EFFECTIVE_TOO_SOON | AI_SETTINGS_INVALID
-- | AI_ROUTE_INVALID), ERRCODE '22023', HINT = mô tả kỹ thuật ngắn. TS ánh xạ theo `error.message` (hoặc `cause.message` của driver).
-- Kiểm 10× và TTL effective_from (60 s theo đồng hồ CSDL) là kiểm CỨNG ở SQL, dưới khóa tư vấn (không còn TOCTOU).
-- Kiểm mềm còn ở TS (bật fallback chỉ khi có rank 2) dùng hàm ĐỌC.

-- Ghi kiểm toán dùng chung (không cấp EXECUTE cho ai; chỉ các hàm bên dưới, chạy bằng chủ sở hữu, gọi được).
CREATE OR REPLACE FUNCTION ai_gateway.admin_write_audit(
  p_id uuid, p_actor uuid, p_action text, p_trace text, p_metadata jsonb
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
BEGIN
  -- Mã dòng kiểm toán là UUID v7 do ứng dụng sinh; không tự sinh v4 ở CSDL.
  IF p_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'AI_SETTINGS_INVALID', ERRCODE = '22023', HINT = 'thiếu mã dòng kiểm toán (uuid v7)';
  END IF;
  INSERT INTO infra.audit_log (id, account_id, actor_type, actor_id, action, trace_id, metadata)
  VALUES (p_id, NULL, 'admin', p_actor::text, p_action, nullif(p_trace, ''), p_metadata);
END
$$;
--> statement-breakpoint

-- ===== GHI ================================================================================================================

-- Thêm dòng giá (bảng chỉ-thêm). Trả id dòng mới + dòng giá LIỀN TRƯỚC theo effective_from (cột old_*; NULL nếu là dòng đầu).
-- Kiểm cứng ở SQL: unit hợp lệ, giá > 0 đúng theo unit, granularity > 0, TTL 60 s (AI_PRICE_EFFECTIVE_TOO_SOON), lệch ≤ 10×
-- so với dòng liền trước VÀ liền sau (AI_PRICE_IMPLAUSIBLE) – dưới khóa tư vấn theo (provider, model, unit).
CREATE OR REPLACE FUNCTION ai_gateway.admin_add_price(
  p_price_id uuid,
  p_provider text,
  p_model_id text,
  p_unit text,
  p_input_per_mtok bigint,
  p_output_per_mtok bigint,
  p_cached_input_per_mtok bigint,
  p_per_minute bigint,
  p_billing_granularity_sec integer,
  p_effective_from timestamptz,
  p_actor uuid,
  p_trace text,
  p_audit_id uuid
) RETURNS TABLE (
  price_id uuid,
  old_price_id uuid,
  old_input_per_mtok bigint,
  old_output_per_mtok bigint,
  old_cached_input_per_mtok bigint,
  old_per_minute bigint,
  old_effective_from timestamptz
)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
DECLARE
  o ai_gateway.model_prices%ROWTYPE;
  nx ai_gateway.model_prices%ROWTYPE;
  v_gran integer := coalesce(p_billing_granularity_sec, 1);
BEGIN
  IF p_price_id IS NULL OR coalesce(p_provider, '') = '' OR coalesce(p_model_id, '') = '' OR p_effective_from IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'AI_PRICE_IMPLAUSIBLE', ERRCODE = '22023', HINT = 'thiếu mã giá/provider/model/effective_from/actor';
  END IF;
  IF p_unit = 'token' THEN
    IF coalesce(p_input_per_mtok, 0) <= 0 OR coalesce(p_output_per_mtok, 0) <= 0
       OR (p_cached_input_per_mtok IS NOT NULL AND p_cached_input_per_mtok <= 0) OR p_per_minute IS NOT NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'AI_PRICE_IMPLAUSIBLE', ERRCODE = '22023', HINT = 'unit=token: input, output > 0; cached NULL hoặc > 0; per_minute NULL';
    END IF;
  ELSIF p_unit = 'audio_minute' THEN
    IF coalesce(p_per_minute, 0) <= 0 OR p_input_per_mtok IS NOT NULL OR p_output_per_mtok IS NOT NULL
       OR p_cached_input_per_mtok IS NOT NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'AI_PRICE_IMPLAUSIBLE', ERRCODE = '22023', HINT = 'unit=audio_minute: per_minute > 0, các trường token NULL';
    END IF;
  ELSE
    RAISE EXCEPTION USING MESSAGE = 'AI_PRICE_IMPLAUSIBLE', ERRCODE = '22023', HINT = 'unit không hợp lệ';
  END IF;
  IF v_gran <= 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'AI_PRICE_IMPLAUSIBLE', ERRCODE = '22023', HINT = 'billing_granularity_sec phải > 0';
  END IF;

  -- TTL: giá mới không hiệu lực sớm hơn now() + 60 s (đồng hồ CSDL; đệm giá ở ứng dụng ≤ 60 s).
  IF p_effective_from < now() + interval '60 seconds' THEN
    RAISE EXCEPTION USING MESSAGE = 'AI_PRICE_EFFECTIVE_TOO_SOON', ERRCODE = '22023',
      HINT = 'effective_from phải >= now() + 60 giây';
  END IF;

  -- Tuần tự hóa các lần thêm giá cùng (provider, model, unit).
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_price:' || p_provider || '/' || p_model_id || '/' || p_unit, 0));

  -- Dòng LIỀN TRƯỚC theo thời gian hiệu lực (effective_from lớn nhất <= của dòng mới) và dòng LIỀN SAU (nhỏ nhất > của dòng mới,
  -- tức giá hẹn giờ tương lai). Dòng mới phải nằm trong 10× của CẢ HAI → hai lần thêm 10× liên tiếp không nâng 100×.
  SELECT * INTO o FROM ai_gateway.model_prices mp
   WHERE mp.provider = p_provider AND mp.model_id = p_model_id AND mp.unit = p_unit AND mp.effective_from <= p_effective_from
   ORDER BY mp.effective_from DESC, mp.id DESC LIMIT 1;
  SELECT * INTO nx FROM ai_gateway.model_prices mp
   WHERE mp.provider = p_provider AND mp.model_id = p_model_id AND mp.unit = p_unit AND mp.effective_from > p_effective_from
   ORDER BY mp.effective_from ASC, mp.id ASC LIMIT 1;

  -- Đúng 10× hợp lệ (next <= 10*cur VÀ 10*next >= cur); số học numeric tránh tràn bigint. Trường NULL một phía → bỏ qua.
  -- Dòng giá đầu (không có dòng liền trước/sau) chỉ cần > 0 (đã kiểm ở trên).
  IF o.id IS NOT NULL THEN
    IF (p_input_per_mtok IS NOT NULL AND o.input_per_mtok IS NOT NULL AND NOT (
          p_input_per_mtok::numeric <= o.input_per_mtok::numeric * 10 AND p_input_per_mtok::numeric * 10 >= o.input_per_mtok::numeric))
       OR (p_output_per_mtok IS NOT NULL AND o.output_per_mtok IS NOT NULL AND NOT (
          p_output_per_mtok::numeric <= o.output_per_mtok::numeric * 10 AND p_output_per_mtok::numeric * 10 >= o.output_per_mtok::numeric))
       OR (p_cached_input_per_mtok IS NOT NULL AND o.cached_input_per_mtok IS NOT NULL AND NOT (
          p_cached_input_per_mtok::numeric <= o.cached_input_per_mtok::numeric * 10
          AND p_cached_input_per_mtok::numeric * 10 >= o.cached_input_per_mtok::numeric))
       OR (p_per_minute IS NOT NULL AND o.per_minute IS NOT NULL AND NOT (
          p_per_minute::numeric <= o.per_minute::numeric * 10 AND p_per_minute::numeric * 10 >= o.per_minute::numeric)) THEN
      RAISE EXCEPTION USING MESSAGE = 'AI_PRICE_IMPLAUSIBLE', ERRCODE = '22023', HINT = 'lệch quá 10 lần so với dòng giá liền trước';
    END IF;
  END IF;
  IF nx.id IS NOT NULL THEN
    IF (p_input_per_mtok IS NOT NULL AND nx.input_per_mtok IS NOT NULL AND NOT (
          p_input_per_mtok::numeric <= nx.input_per_mtok::numeric * 10 AND p_input_per_mtok::numeric * 10 >= nx.input_per_mtok::numeric))
       OR (p_output_per_mtok IS NOT NULL AND nx.output_per_mtok IS NOT NULL AND NOT (
          p_output_per_mtok::numeric <= nx.output_per_mtok::numeric * 10 AND p_output_per_mtok::numeric * 10 >= nx.output_per_mtok::numeric))
       OR (p_cached_input_per_mtok IS NOT NULL AND nx.cached_input_per_mtok IS NOT NULL AND NOT (
          p_cached_input_per_mtok::numeric <= nx.cached_input_per_mtok::numeric * 10
          AND p_cached_input_per_mtok::numeric * 10 >= nx.cached_input_per_mtok::numeric))
       OR (p_per_minute IS NOT NULL AND nx.per_minute IS NOT NULL AND NOT (
          p_per_minute::numeric <= nx.per_minute::numeric * 10 AND p_per_minute::numeric * 10 >= nx.per_minute::numeric)) THEN
      RAISE EXCEPTION USING MESSAGE = 'AI_PRICE_IMPLAUSIBLE', ERRCODE = '22023', HINT = 'lệch quá 10 lần so với dòng giá liền sau (hẹn giờ)';
    END IF;
  END IF;

  INSERT INTO ai_gateway.model_prices
    (id, provider, model_id, unit, input_per_mtok, output_per_mtok, cached_input_per_mtok, per_minute,
     billing_granularity_sec, effective_from, created_by)
  VALUES (p_price_id, p_provider, p_model_id, p_unit, p_input_per_mtok, p_output_per_mtok, p_cached_input_per_mtok,
          p_per_minute, v_gran, p_effective_from, p_actor::text);

  PERFORM ai_gateway.admin_write_audit(p_audit_id, p_actor, 'ai.price.add', p_trace, jsonb_build_object(
    'priceId', p_price_id, 'provider', p_provider, 'modelId', p_model_id, 'unit', p_unit,
    'old', CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object(
        'priceId', o.id, 'inputPerMTok', o.input_per_mtok, 'outputPerMTok', o.output_per_mtok,
        'cachedInputPerMTok', o.cached_input_per_mtok, 'perMinute', o.per_minute,
        'effectiveFrom', to_char(o.effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END,
    'new', jsonb_build_object(
        'inputPerMTok', p_input_per_mtok, 'outputPerMTok', p_output_per_mtok,
        'cachedInputPerMTok', p_cached_input_per_mtok, 'perMinute', p_per_minute,
        'billingGranularitySec', v_gran),
    'effectiveFrom', to_char(p_effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));

  RETURN QUERY SELECT p_price_id, o.id, o.input_per_mtok, o.output_per_mtok, o.cached_input_per_mtok, o.per_minute,
                      o.effective_from;
END
$$;
--> statement-breakpoint

-- Đổi cấu hình trần/ngưỡng/ngân sách ngành. NULL = giữ nguyên. Kiểm tra trên giá trị GỘP: mọi giá trị > 0, soft < cap.
-- Mỗi trường THỰC SỰ đổi sinh một dòng kiểm toán `ai.settings.change` {field, old, new}. Trả số trường đã đổi.
-- Chu kỳ/tuần đã tạo giữ giá trị chụp cũ (chỉ áp cho chu kỳ tạo sau).
CREATE OR REPLACE FUNCTION ai_gateway.admin_set_settings(
  p_account_cap bigint,
  p_soft_limit bigint,
  p_per_industry_weekly bigint,
  p_actor uuid,
  p_trace text,
  p_audit_ids uuid[]
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
DECLARE
  s ai_gateway.ai_settings%ROWTYPE;
  v_cap bigint;
  v_soft bigint;
  v_ind bigint;
  n integer := 0;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'AI_SETTINGS_INVALID', ERRCODE = '22023', HINT = 'thiếu actor';
  END IF;
  SELECT * INTO s FROM ai_gateway.ai_settings WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'AI_SETTINGS_INVALID', ERRCODE = '22023', HINT = 'chưa có dòng cấu hình id=1';
  END IF;
  v_cap := coalesce(p_account_cap, s.account_cap_micro_usd);
  v_soft := coalesce(p_soft_limit, s.account_soft_limit_micro_usd);
  v_ind := coalesce(p_per_industry_weekly, s.per_industry_weekly_micro_usd);
  IF v_cap <= 0 OR v_soft <= 0 OR v_ind <= 0 OR v_soft >= v_cap THEN
    RAISE EXCEPTION USING MESSAGE = 'AI_SETTINGS_INVALID', ERRCODE = '22023', HINT = 'cần mọi giá trị > 0 và soft < cap';
  END IF;

  IF v_cap = s.account_cap_micro_usd AND v_soft = s.account_soft_limit_micro_usd
     AND v_ind = s.per_industry_weekly_micro_usd THEN
    RETURN 0;
  END IF;

  UPDATE ai_gateway.ai_settings
     SET account_cap_micro_usd = v_cap, account_soft_limit_micro_usd = v_soft,
         per_industry_weekly_micro_usd = v_ind, updated_at = now(), updated_by = p_actor::text
   WHERE id = 1;

  IF v_cap <> s.account_cap_micro_usd THEN
    n := n + 1;
    PERFORM ai_gateway.admin_write_audit(p_audit_ids[1], p_actor, 'ai.settings.change', p_trace,
      jsonb_build_object('field', 'accountCapMicroUsd', 'old', s.account_cap_micro_usd, 'new', v_cap));
  END IF;
  IF v_soft <> s.account_soft_limit_micro_usd THEN
    n := n + 1;
    PERFORM ai_gateway.admin_write_audit(p_audit_ids[2], p_actor, 'ai.settings.change', p_trace,
      jsonb_build_object('field', 'accountSoftLimitMicroUsd', 'old', s.account_soft_limit_micro_usd, 'new', v_soft));
  END IF;
  IF v_ind <> s.per_industry_weekly_micro_usd THEN
    n := n + 1;
    PERFORM ai_gateway.admin_write_audit(p_audit_ids[3], p_actor, 'ai.settings.change', p_trace,
      jsonb_build_object('field', 'perIndustryWeeklyMicroUsd', 'old', s.per_industry_weekly_micro_usd, 'new', v_ind));
  END IF;
  RETURN n;
END
$$;
--> statement-breakpoint

-- Đặt tuyến (tier, rank). Kiểm cứng: tier ∈ 4 bậc, rank ∈ {1,2}, mô hình đã có ít nhất một dòng giá (kể cả hiệu lực tương lai).
CREATE OR REPLACE FUNCTION ai_gateway.admin_set_route(
  p_tier text,
  p_rank integer,
  p_provider text,
  p_model_id text,
  p_enabled boolean,
  p_actor uuid,
  p_trace text,
  p_audit_id uuid
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
DECLARE
  r ai_gateway.model_routes%ROWTYPE;
BEGIN
  IF p_tier IS NULL OR p_rank IS NULL OR p_tier NOT IN ('default', 'cheap', 'cheap_vision', 'stt') OR p_rank NOT IN (1, 2)
     OR coalesce(p_provider, '') = '' OR coalesce(p_model_id, '') = '' OR p_enabled IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'AI_ROUTE_INVALID', ERRCODE = '22023', HINT = 'tier/rank/provider/model không hợp lệ';
  END IF;
  -- Mô hình phải có giá ĐÚNG đơn vị của bậc: stt tính theo phút âm thanh, các bậc còn lại theo token.
  PERFORM 1 FROM ai_gateway.model_prices mp WHERE mp.provider = p_provider AND mp.model_id = p_model_id
     AND mp.unit = CASE WHEN p_tier = 'stt' THEN 'audio_minute' ELSE 'token' END LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'AI_ROUTE_INVALID', ERRCODE = '22023', HINT = 'mô hình chưa có dòng giá đúng đơn vị của bậc';
  END IF;

  SELECT * INTO r FROM ai_gateway.model_routes WHERE tier = p_tier AND rank = p_rank FOR UPDATE;

  INSERT INTO ai_gateway.model_routes (tier, rank, provider, model_id, enabled, updated_at, updated_by)
  VALUES (p_tier, p_rank::smallint, p_provider, p_model_id, p_enabled, now(), p_actor::text)
  ON CONFLICT (tier, rank) DO UPDATE
    SET provider = EXCLUDED.provider, model_id = EXCLUDED.model_id, enabled = EXCLUDED.enabled,
        updated_at = now(), updated_by = EXCLUDED.updated_by;

  PERFORM ai_gateway.admin_write_audit(p_audit_id, p_actor, 'ai.route.change', p_trace, jsonb_build_object(
    'tier', p_tier, 'rank', p_rank,
    'old', CASE WHEN r.tier IS NULL THEN NULL
                ELSE jsonb_build_object('provider', r.provider, 'modelId', r.model_id, 'enabled', r.enabled) END,
    'new', jsonb_build_object('provider', p_provider, 'modelId', p_model_id, 'enabled', p_enabled)));
END
$$;
--> statement-breakpoint

-- Bật/tắt dự phòng theo loại việc. Kiểm cứng: task hợp lệ và dòng đã có sẵn (đủ 6 dòng từ 0030). Kiểm "có tuyến rank 2 của bậc" ở TS.
CREATE OR REPLACE FUNCTION ai_gateway.admin_set_task_fallback(
  p_task text,
  p_enabled boolean,
  p_actor uuid,
  p_trace text,
  p_audit_id uuid
) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
DECLARE
  v_old boolean;
BEGIN
  IF p_task IS NULL OR p_task NOT IN ('post_generation', 'topic_suggestion', 'image_labeling', 'video_labeling', 'transcription', 'trend_summary')
     OR p_enabled IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'AI_ROUTE_INVALID', ERRCODE = '22023', HINT = 'task không hợp lệ';
  END IF;
  SELECT enabled INTO v_old FROM ai_gateway.task_fallback WHERE task = p_task FOR UPDATE;
  INSERT INTO ai_gateway.task_fallback (task, enabled, updated_at, updated_by)
  VALUES (p_task, p_enabled, now(), p_actor::text)
  ON CONFLICT (task) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = EXCLUDED.updated_by;

  PERFORM ai_gateway.admin_write_audit(p_audit_id, p_actor, 'ai.task_fallback.change', p_trace,
    jsonb_build_object('task', p_task, 'old', v_old, 'new', p_enabled));
  RETURN v_old;
END
$$;
--> statement-breakpoint

-- Nhập hóa đơn nhà cung cấp; trùng (provider, invoice_date) thì thay thế kèm kiểm toán giá trị cũ/mới. Trả tổng cũ (NULL nếu mới).
CREATE OR REPLACE FUNCTION ai_gateway.admin_enter_invoice(
  p_id uuid,
  p_provider text,
  p_invoice_date date,
  p_total bigint,
  p_actor uuid,
  p_trace text,
  p_audit_id uuid
) RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
DECLARE
  v_old bigint;
BEGIN
  IF p_id IS NULL OR coalesce(p_provider, '') = '' OR p_invoice_date IS NULL OR p_total IS NULL OR p_total < 0 OR p_actor IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'AI_SETTINGS_INVALID', ERRCODE = '22023', HINT = 'hóa đơn: mã, provider, ngày, tổng ≥ 0';
  END IF;
  SELECT total_micro_usd INTO v_old FROM ai_gateway.provider_invoices
   WHERE provider = p_provider AND invoice_date = p_invoice_date FOR UPDATE;
  INSERT INTO ai_gateway.provider_invoices (id, provider, invoice_date, total_micro_usd, entered_by)
  VALUES (p_id, p_provider, p_invoice_date, p_total, p_actor::text)
  ON CONFLICT (provider, invoice_date) DO UPDATE
    SET total_micro_usd = EXCLUDED.total_micro_usd, entered_by = EXCLUDED.entered_by, entered_at = now();

  PERFORM ai_gateway.admin_write_audit(p_audit_id, p_actor, 'ai.invoice.enter', p_trace, jsonb_build_object(
    'provider', p_provider, 'invoiceDate', p_invoice_date::text, 'old', v_old, 'new', p_total));
  RETURN v_old;
END
$$;
--> statement-breakpoint

-- ===== ĐỌC (chỉ-đọc, cho kiểm tra ở TS) ====================================================================================

-- Giá hiện hành (effective_from <= now) của (provider, model, unit); không có → 0 dòng.
CREATE OR REPLACE FUNCTION ai_gateway.admin_get_current_price(p_provider text, p_model_id text, p_unit text)
  RETURNS TABLE (
    price_id uuid, unit text, input_per_mtok bigint, output_per_mtok bigint, cached_input_per_mtok bigint,
    per_minute bigint, billing_granularity_sec integer, effective_from timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
  SELECT mp.id, mp.unit, mp.input_per_mtok, mp.output_per_mtok, mp.cached_input_per_mtok, mp.per_minute,
         mp.billing_granularity_sec, mp.effective_from
    FROM ai_gateway.model_prices mp
   WHERE mp.provider = p_provider AND mp.model_id = p_model_id AND mp.unit = p_unit AND mp.effective_from <= now()
   ORDER BY mp.effective_from DESC, mp.id DESC LIMIT 1
$$;
--> statement-breakpoint

-- Cấu hình hiện tại (một dòng).
CREATE OR REPLACE FUNCTION ai_gateway.admin_get_settings()
  RETURNS TABLE (account_cap_micro_usd bigint, account_soft_limit_micro_usd bigint, per_industry_weekly_micro_usd bigint)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
  SELECT s.account_cap_micro_usd, s.account_soft_limit_micro_usd, s.per_industry_weekly_micro_usd
    FROM ai_gateway.ai_settings s WHERE s.id = 1
$$;
--> statement-breakpoint

-- Mô hình đã có ít nhất một dòng giá (kể cả hiệu lực tương lai) đúng đơn vị `p_unit` chưa. `p_unit` NULL = đơn vị bất kỳ.
CREATE OR REPLACE FUNCTION ai_gateway.admin_model_has_price(p_provider text, p_model_id text, p_unit text DEFAULT NULL)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
  SELECT EXISTS (SELECT 1 FROM ai_gateway.model_prices mp
                  WHERE mp.provider = p_provider AND mp.model_id = p_model_id AND (p_unit IS NULL OR mp.unit = p_unit))
$$;
--> statement-breakpoint

-- Tuyến (tier, rank) hiện tại; không có → 0 dòng. TS dùng rank 2 để quyết định cho phép bật dự phòng.
CREATE OR REPLACE FUNCTION ai_gateway.admin_get_route(p_tier text, p_rank integer)
  RETURNS TABLE (provider text, model_id text, enabled boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
  SELECT r.provider, r.model_id, r.enabled FROM ai_gateway.model_routes r WHERE r.tier = p_tier AND r.rank = p_rank
$$;
--> statement-breakpoint

-- ===== QUYỀN ================================================================================================================
REVOKE ALL ON FUNCTION ai_gateway.admin_write_audit(uuid, uuid, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.admin_add_price(uuid, text, text, text, bigint, bigint, bigint, bigint, integer, timestamptz, uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.admin_set_settings(bigint, bigint, bigint, uuid, text, uuid[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.admin_set_route(text, integer, text, text, boolean, uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.admin_set_task_fallback(text, boolean, uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.admin_enter_invoice(uuid, text, date, bigint, uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.admin_get_current_price(text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.admin_get_settings() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.admin_model_has_price(text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.admin_get_route(text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.admin_add_price(uuid, text, text, text, bigint, bigint, bigint, bigint, integer, timestamptz, uuid, text, uuid) TO "support";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.admin_set_settings(bigint, bigint, bigint, uuid, text, uuid[]) TO "support";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.admin_set_route(text, integer, text, text, boolean, uuid, text, uuid) TO "support";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.admin_set_task_fallback(text, boolean, uuid, text, uuid) TO "support";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.admin_enter_invoice(uuid, text, date, bigint, uuid, text, uuid) TO "support";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.admin_get_current_price(text, text, text) TO "support";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.admin_get_settings() TO "support";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.admin_model_has_price(text, text, text) TO "support";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.admin_get_route(text, integer) TO "support";
