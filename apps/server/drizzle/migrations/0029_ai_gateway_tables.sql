CREATE TABLE "ai_gateway"."ai_budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cycle_start" date NOT NULL,
	"cycle_end" date NOT NULL,
	"used" bigint DEFAULT 0 NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"cap" bigint NOT NULL,
	"soft_limit" bigint NOT NULL,
	"notified_80" boolean DEFAULT false NOT NULL,
	"notified_100" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ai_budgets_within_cap" CHECK ("used" >= 0 AND "reserved" >= 0 AND "used" + "reserved" <= "cap"),
	CONSTRAINT "ai_budgets_soft_below_cap" CHECK ("soft_limit" < "cap" AND "cap" > 0),
	CONSTRAINT "ai_budgets_cycle_order" CHECK ("cycle_end" > "cycle_start")
);
--> statement-breakpoint
ALTER TABLE "ai_gateway"."ai_budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_gateway"."ai_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cycle_start" date NOT NULL,
	"task" text NOT NULL,
	"model_tier" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"price_id" uuid NOT NULL,
	"estimate" bigint NOT NULL,
	"state" text DEFAULT 'held' NOT NULL,
	"request_id" text,
	"trace_id" text,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"called_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "ai_reservations_estimate_non_negative" CHECK ("estimate" >= 0),
	CONSTRAINT "ai_reservations_state_check" CHECK ("state" IN ('held','calling','settled','released')),
	CONSTRAINT "ai_reservations_task_check" CHECK ("task" IN ('post_generation','topic_suggestion','image_labeling','video_labeling','transcription','trend_summary')),
	CONSTRAINT "ai_reservations_tier_check" CHECK ("model_tier" IN ('default','cheap','cheap_vision','stt')),
	CONSTRAINT "ai_reservations_request_id_length" CHECK ("request_id" IS NULL OR char_length("request_id") <= 128)
);
--> statement-breakpoint
ALTER TABLE "ai_gateway"."ai_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_gateway"."ai_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"account_cap_micro_usd" bigint NOT NULL,
	"account_soft_limit_micro_usd" bigint NOT NULL,
	"per_industry_weekly_micro_usd" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "ai_settings_single_row" CHECK ("id" = 1),
	CONSTRAINT "ai_settings_limits" CHECK ("account_soft_limit_micro_usd" < "account_cap_micro_usd" AND "per_industry_weekly_micro_usd" > 0 AND "account_soft_limit_micro_usd" > 0)
);
--> statement-breakpoint
CREATE TABLE "ai_gateway"."ai_trend_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"week_start" date NOT NULL,
	"industry_id" uuid NOT NULL,
	"cost_micro_usd" bigint NOT NULL,
	"shared_ledger_id" uuid NOT NULL,
	CONSTRAINT "ai_trend_allocations_cost_non_negative" CHECK ("cost_micro_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_gateway"."ai_trend_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_gateway"."model_prices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"unit" text NOT NULL,
	"input_per_mtok" bigint,
	"output_per_mtok" bigint,
	"cached_input_per_mtok" bigint,
	"per_minute" bigint,
	"billing_granularity_sec" integer DEFAULT 1 NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_prices_unit_check" CHECK ("unit" IN ('token', 'audio_minute')),
	CONSTRAINT "model_prices_granularity_check" CHECK ("billing_granularity_sec" > 0),
	CONSTRAINT "model_prices_positive_matches_unit" CHECK ((
        "unit" = 'token'
        AND "input_per_mtok" IS NOT NULL AND "input_per_mtok" > 0
        AND "output_per_mtok" IS NOT NULL AND "output_per_mtok" > 0
        AND ("cached_input_per_mtok" IS NULL OR "cached_input_per_mtok" > 0)
        AND "per_minute" IS NULL
      ) OR (
        "unit" = 'audio_minute'
        AND "per_minute" IS NOT NULL AND "per_minute" > 0
        AND "input_per_mtok" IS NULL AND "output_per_mtok" IS NULL AND "cached_input_per_mtok" IS NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "ai_gateway"."model_routes" (
	"tier" text NOT NULL,
	"rank" smallint NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "model_routes_pkey" PRIMARY KEY("tier","rank"),
	CONSTRAINT "model_routes_rank_check" CHECK ("rank" IN (1, 2)),
	CONSTRAINT "model_routes_tier_check" CHECK ("tier" IN ('default','cheap','cheap_vision','stt'))
);
--> statement-breakpoint
CREATE TABLE "ai_gateway"."provider_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"invoice_date" date NOT NULL,
	"total_micro_usd" bigint NOT NULL,
	"entered_by" text NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_invoices_total_non_negative" CHECK ("total_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_gateway"."system_budgets" (
	"week_start" date PRIMARY KEY NOT NULL,
	"used" bigint DEFAULT 0 NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"cap" bigint NOT NULL,
	"industry_count" integer,
	"per_industry_micro_usd" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_budgets_within_cap" CHECK ("used" >= 0 AND "reserved" >= 0 AND "used" + "reserved" <= "cap"),
	CONSTRAINT "system_budgets_cap_positive" CHECK ("cap" > 0)
);
--> statement-breakpoint
CREATE TABLE "ai_gateway"."system_cost_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"industry_id" uuid,
	"reservation_id" uuid NOT NULL,
	"request_id" text,
	"task" text NOT NULL,
	"model_tier" text NOT NULL,
	"model_id" text NOT NULL,
	"provider" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"audio_seconds" integer,
	"cost_micro_usd" bigint NOT NULL,
	"estimate_micro_usd" bigint NOT NULL,
	"anomaly" text,
	"over_cap_micro_usd" bigint DEFAULT 0 NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_cost_ledger_anomaly_check" CHECK ("anomaly" IS NULL OR "anomaly" IN ('over_estimate', 'unsettled', 'missing_usage')),
	CONSTRAINT "system_cost_ledger_cost_non_negative" CHECK ("cost_micro_usd" >= 0 AND "over_cap_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_gateway"."system_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"industry_id" uuid,
	"task" text NOT NULL,
	"model_tier" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"price_id" uuid NOT NULL,
	"estimate" bigint NOT NULL,
	"state" text DEFAULT 'held' NOT NULL,
	"request_id" text,
	"trace_id" text,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"called_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "system_reservations_estimate_non_negative" CHECK ("estimate" >= 0),
	CONSTRAINT "system_reservations_state_check" CHECK ("state" IN ('held','calling','settled','released'))
);
--> statement-breakpoint
CREATE TABLE "ai_gateway"."task_fallback" (
	"task" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "task_fallback_task_check" CHECK ("task" IN ('post_generation','topic_suggestion','image_labeling','video_labeling','transcription','trend_summary'))
);
--> statement-breakpoint
ALTER TABLE "ai_gateway"."ai_budgets" ADD CONSTRAINT "ai_budgets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_gateway"."ai_reservations" ADD CONSTRAINT "ai_reservations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_gateway"."ai_reservations" ADD CONSTRAINT "ai_reservations_price_id_model_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "ai_gateway"."model_prices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_gateway"."ai_trend_allocations" ADD CONSTRAINT "ai_trend_allocations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_gateway"."system_reservations" ADD CONSTRAINT "system_reservations_week_start_system_budgets_week_start_fk" FOREIGN KEY ("week_start") REFERENCES "ai_gateway"."system_budgets"("week_start") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_gateway"."system_reservations" ADD CONSTRAINT "system_reservations_price_id_model_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "ai_gateway"."model_prices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_budgets_account_id_idx" ON "ai_gateway"."ai_budgets" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_budgets_account_cycle_key" ON "ai_gateway"."ai_budgets" USING btree ("account_id","cycle_start");--> statement-breakpoint
CREATE INDEX "ai_budgets_account_cycle_idx" ON "ai_gateway"."ai_budgets" USING btree ("account_id","cycle_start" DESC);--> statement-breakpoint
CREATE INDEX "ai_reservations_account_id_idx" ON "ai_gateway"."ai_reservations" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ai_reservations_account_state_idx" ON "ai_gateway"."ai_reservations" USING btree ("account_id","state","reserved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_reservations_request_key" ON "ai_gateway"."ai_reservations" USING btree ("account_id","cycle_start","request_id") WHERE "request_id" IS NOT NULL AND "state" <> 'released';--> statement-breakpoint
CREATE INDEX "ai_trend_allocations_account_id_idx" ON "ai_gateway"."ai_trend_allocations" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_trend_allocations_key" ON "ai_gateway"."ai_trend_allocations" USING btree ("account_id","week_start","industry_id","shared_ledger_id");--> statement-breakpoint
CREATE INDEX "model_prices_lookup_idx" ON "ai_gateway"."model_prices" USING btree ("provider","model_id","unit","effective_from" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "provider_invoices_key" ON "ai_gateway"."provider_invoices" USING btree ("provider","invoice_date");--> statement-breakpoint
CREATE INDEX "system_cost_ledger_week_idx" ON "ai_gateway"."system_cost_ledger" USING btree ("week_start","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "system_cost_ledger_reservation_key" ON "ai_gateway"."system_cost_ledger" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "system_reservations_state_idx" ON "ai_gateway"."system_reservations" USING btree ("state","reserved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "system_reservations_request_key" ON "ai_gateway"."system_reservations" USING btree ("week_start","request_id") WHERE "request_id" IS NOT NULL AND "state" <> 'released';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_gateway"."ai_budgets" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_gateway"."ai_reservations" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_gateway"."ai_trend_allocations" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint

-- ===== Phần viết tay (015, T005/T006) =====================================================================
-- Chỉ thêm bảng/hàm/trigger → tương thích ngược (API, Worker cũ không chạm schema ai_gateway mới).

-- 1) `model_prices` CHỈ THÊM: mọi UPDATE/DELETE bị chặn (đổi giá = thêm dòng mới có effective_from sau, FR-020).
CREATE OR REPLACE FUNCTION ai_gateway.model_prices_append_only() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'model_prices chỉ được thêm dòng mới, không sửa hoặc xóa (FR-020)' USING ERRCODE = '42501';
END
$$;
--> statement-breakpoint
CREATE TRIGGER model_prices_no_update_delete BEFORE UPDATE OR DELETE ON ai_gateway.model_prices
  FOR EACH ROW EXECUTE FUNCTION ai_gateway.model_prices_append_only();
--> statement-breakpoint
CREATE TRIGGER model_prices_no_truncate BEFORE TRUNCATE ON ai_gateway.model_prices
  FOR EACH STATEMENT EXECUTE FUNCTION ai_gateway.model_prices_append_only();
--> statement-breakpoint

-- 2) Sổ chi phí AI `ai_cost_ledger` CHỈ-THÊM, phân vùng theo tháng (data-model.md mục 2.3; khuôn 0020).
--    Định nghĩa Drizzle để chèn có kiểu: modules/ai_gateway/internal/db/ai-cost-ledger.log-table.ts.
CREATE TABLE ai_gateway.ai_cost_ledger (
  id uuid NOT NULL,
  -- Không khóa ngoại: sổ sống lâu hơn tài khoản (chỉ số liệu và mã, không dữ liệu cá nhân).
  account_id uuid NOT NULL,
  cycle_start date NOT NULL,
  -- Tham chiếu ai_reservations; KHÔNG khóa ngoại (bảng phân vùng).
  reservation_id uuid NOT NULL,
  request_id text NULL,
  task text NOT NULL CHECK (task IN ('post_generation', 'topic_suggestion', 'image_labeling', 'video_labeling', 'transcription', 'trend_summary')),
  model_tier text NOT NULL CHECK (model_tier IN ('default', 'cheap', 'cheap_vision', 'stt')),
  model_id text NOT NULL,
  provider text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cached_input_tokens integer NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  audio_seconds integer NULL CHECK (audio_seconds IS NULL OR audio_seconds >= 0),
  cost_micro_usd bigint NOT NULL CHECK (cost_micro_usd >= 0),
  estimate_micro_usd bigint NOT NULL CHECK (estimate_micro_usd >= 0),
  anomaly text NULL CHECK (anomaly IS NULL OR anomaly IN ('over_estimate', 'unsettled', 'missing_usage')),
  over_cap_micro_usd bigint NOT NULL DEFAULT 0 CHECK (over_cap_micro_usd >= 0),
  trace_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (created_at, id)
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
CREATE INDEX ai_cost_ledger_account_cycle_idx ON ai_gateway.ai_cost_ledger (account_id, cycle_start, created_at);
--> statement-breakpoint
-- Chỉ INSERT + SELECT: sổ bất biến; xóa bằng bỏ cả phân vùng > 12 tháng. Quyền mặc định của schema cấp cả
-- UPDATE, DELETE cho bảng mới → thu hồi tường minh.
REVOKE UPDATE, DELETE, TRUNCATE ON ai_gateway.ai_cost_ledger FROM "app", "system";
--> statement-breakpoint
GRANT SELECT, INSERT ON ai_gateway.ai_cost_ledger TO "app", "system";
--> statement-breakpoint
ALTER TABLE ai_gateway.ai_cost_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_gateway.ai_cost_ledger AS PERMISSIVE FOR ALL TO "app", "system"
  USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ai_gateway.ensure_ai_cost_ledger_partitions(months_ahead int DEFAULT 1)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, ai_gateway
AS $$
DECLARE
  first_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  month_start date;
  partition_name text;
BEGIN
  IF months_ahead < 0 OR months_ahead > 24 THEN
    RAISE EXCEPTION 'months_ahead phải trong khoảng 0–24';
  END IF;
  FOR i IN 0..months_ahead LOOP
    month_start := (first_month + make_interval(months => i))::date;
    partition_name := format('ai_cost_ledger_y%sm%s', to_char(month_start, 'YYYY'), to_char(month_start, 'MM'));
    IF to_regclass(format('ai_gateway.%I', partition_name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE ai_gateway.%I PARTITION OF ai_gateway.ai_cost_ledger FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        month_start::timestamp AT TIME ZONE 'UTC',
        (month_start + interval '1 month')::timestamp AT TIME ZONE 'UTC'
      );
      -- Phân vùng không có chính sách → chặn truy cập thẳng vào phân vùng của mọi vai trò ứng dụng.
      EXECUTE format('ALTER TABLE ai_gateway.%I ENABLE ROW LEVEL SECURITY', partition_name);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.ensure_ai_cost_ledger_partitions(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.ensure_ai_cost_ledger_partitions(int) TO "system";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ai_gateway.drop_ai_cost_ledger_partitions_before(months int) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, ai_gateway
AS $$
DECLARE
  cutoff timestamptz;
  part record;
  upper_bound timestamptz;
  n int := 0;
BEGIN
  IF months < 1 OR months > 120 THEN RAISE EXCEPTION 'months phải trong khoảng 1–120'; END IF;
  cutoff := (date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => months)) AT TIME ZONE 'UTC';
  FOR part IN
    SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bound
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
      JOIN pg_namespace n2 ON n2.oid = p.relnamespace
     WHERE n2.nspname = 'ai_gateway' AND p.relname = 'ai_cost_ledger'
  LOOP
    upper_bound := substring(part.bound FROM 'TO \(''([^'']+)''\)')::timestamptz;
    IF upper_bound IS NOT NULL AND upper_bound <= cutoff THEN
      EXECUTE format('DROP TABLE ai_gateway.%I', part.name);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_gateway.drop_ai_cost_ledger_partitions_before(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ai_gateway.drop_ai_cost_ledger_partitions_before(int) TO "system";
--> statement-breakpoint
SELECT ai_gateway.ensure_ai_cost_ledger_partitions(2);