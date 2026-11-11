-- Migration dev 0002 (005, data-model.md mục 5) – bảng trạng thái của bản giả lập Cổng nền tảng, Cổng AI,
-- Thông báo + kịch bản. CHỈ áp khi APP_ENV ∈ {development, test}. Phần sinh bởi drizzle-kit (bảng + RLS)
-- nằm trước phần quyền viết tay ở cuối tệp.
CREATE TABLE "sandbox"."ai_fake_budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cycle_start" date NOT NULL,
	"used" bigint DEFAULT 0 NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"cap" bigint NOT NULL,
	"soft_limit" bigint NOT NULL,
	"notified_80" boolean DEFAULT false NOT NULL,
	"notified_100" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ai_fake_budgets_within_cap" CHECK ("sandbox"."ai_fake_budgets"."used" >= 0 AND "sandbox"."ai_fake_budgets"."reserved" >= 0 AND "sandbox"."ai_fake_budgets"."used" + "sandbox"."ai_fake_budgets"."reserved" <= "sandbox"."ai_fake_budgets"."cap")
);
--> statement-breakpoint
ALTER TABLE "sandbox"."ai_fake_budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sandbox"."ai_fake_cost_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cycle_start" date NOT NULL,
	"reservation_id" uuid NOT NULL,
	"task" text NOT NULL,
	"model_tier" text NOT NULL,
	"model_id" text NOT NULL,
	"provider" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cached_input_tokens" integer NOT NULL,
	"cost_micro_usd" bigint NOT NULL,
	"estimate_micro_usd" bigint NOT NULL,
	"anomaly" text,
	"over_cap_micro_usd" bigint DEFAULT 0 NOT NULL,
	"trace_id" text,
	CONSTRAINT "ai_fake_cost_ledger_anomaly_check" CHECK ("sandbox"."ai_fake_cost_ledger"."anomaly" IS NULL OR "sandbox"."ai_fake_cost_ledger"."anomaly" IN ('over_estimate', 'unsettled'))
);
--> statement-breakpoint
ALTER TABLE "sandbox"."ai_fake_cost_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sandbox"."ai_fake_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cycle_start" date NOT NULL,
	"estimate" bigint NOT NULL,
	"model_tier" text NOT NULL,
	"task" text NOT NULL,
	"state" text DEFAULT 'held' NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"called_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "ai_fake_reservations_state_check" CHECK ("sandbox"."ai_fake_reservations"."state" IN ('held', 'calling', 'settled', 'released')),
	CONSTRAINT "ai_fake_reservations_estimate_non_negative" CHECK ("sandbox"."ai_fake_reservations"."estimate" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sandbox"."ai_fake_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sandbox"."ai_fake_system_budgets" (
	"week_start" date NOT NULL,
	"used" bigint DEFAULT 0 NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"cap" bigint NOT NULL,
	"soft_limit" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_fake_system_budgets_pkey" PRIMARY KEY("week_start"),
	CONSTRAINT "ai_fake_system_budgets_within_cap" CHECK ("sandbox"."ai_fake_system_budgets"."used" >= 0 AND "sandbox"."ai_fake_system_budgets"."reserved" >= 0 AND "sandbox"."ai_fake_system_budgets"."used" + "sandbox"."ai_fake_system_budgets"."reserved" <= "sandbox"."ai_fake_system_budgets"."cap")
);
--> statement-breakpoint
CREATE TABLE "sandbox"."ai_fake_system_cost_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"industry_id" uuid,
	"reservation_id" uuid NOT NULL,
	"task" text NOT NULL,
	"model_tier" text NOT NULL,
	"model_id" text NOT NULL,
	"provider" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cached_input_tokens" integer NOT NULL,
	"cost_micro_usd" bigint NOT NULL,
	"estimate_micro_usd" bigint NOT NULL,
	"anomaly" text,
	"over_cap_micro_usd" bigint DEFAULT 0 NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox"."ai_fake_system_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"industry_id" uuid,
	"estimate" bigint NOT NULL,
	"model_tier" text NOT NULL,
	"task" text NOT NULL,
	"state" text DEFAULT 'held' NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"called_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "ai_fake_system_reservations_state_check" CHECK ("sandbox"."ai_fake_system_reservations"."state" IN ('held', 'calling', 'settled', 'released'))
);
--> statement-breakpoint
CREATE TABLE "sandbox"."fake_scenarios" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"component" text NOT NULL,
	"target" text NOT NULL,
	"spec" jsonb NOT NULL,
	"remaining_uses" integer,
	CONSTRAINT "fake_scenarios_component_check" CHECK ("sandbox"."fake_scenarios"."component" IN ('platform', 'ai', 'notifications', 'mail')),
	CONSTRAINT "fake_scenarios_remaining_uses_check" CHECK ("sandbox"."fake_scenarios"."remaining_uses" IS NULL OR "sandbox"."fake_scenarios"."remaining_uses" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sandbox"."fake_scenarios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sandbox"."ntf_fake_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text NOT NULL,
	"type" text NOT NULL,
	"refs" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sandbox"."ntf_fake_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sandbox"."ntf_fake_notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text NOT NULL,
	"type" text NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"email_batch" text,
	"title_vi" text NOT NULL,
	"body_vi" text NOT NULL,
	"actions" jsonb NOT NULL,
	"refs" jsonb NOT NULL,
	"email_result" text,
	CONSTRAINT "ntf_fake_notifications_channel_check" CHECK ("sandbox"."ntf_fake_notifications"."channel" IN ('in_app', 'email'))
);
--> statement-breakpoint
ALTER TABLE "sandbox"."ntf_fake_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sandbox"."pg_fake_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel_type" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"token_ciphertext" "bytea" NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	CONSTRAINT "pg_fake_connections_status_check" CHECK ("sandbox"."pg_fake_connections"."status" IN ('active', 'disconnected'))
);
--> statement-breakpoint
ALTER TABLE "sandbox"."pg_fake_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sandbox"."pg_fake_oauth_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_hash" "bytea" NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_type" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sandbox"."pg_fake_oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sandbox"."pg_fake_posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"platform_post_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"stored_text_hash" text NOT NULL,
	"permalink" text NOT NULL,
	"state" text NOT NULL,
	"processing_id" text,
	"processing_outcome" text,
	"published_at" timestamp with time zone,
	CONSTRAINT "pg_fake_posts_state_check" CHECK ("sandbox"."pg_fake_posts"."state" IN ('processing', 'published', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "sandbox"."pg_fake_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sandbox"."pg_fake_selections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel_type" text NOT NULL,
	"user_id" uuid NOT NULL,
	"candidates" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sandbox"."pg_fake_selections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sandbox"."ai_fake_budgets" ADD CONSTRAINT "ai_fake_budgets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox"."ai_fake_cost_ledger" ADD CONSTRAINT "ai_fake_cost_ledger_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox"."ai_fake_reservations" ADD CONSTRAINT "ai_fake_reservations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox"."fake_scenarios" ADD CONSTRAINT "fake_scenarios_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox"."ntf_fake_events" ADD CONSTRAINT "ntf_fake_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox"."ntf_fake_notifications" ADD CONSTRAINT "ntf_fake_notifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox"."pg_fake_connections" ADD CONSTRAINT "pg_fake_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox"."pg_fake_oauth_states" ADD CONSTRAINT "pg_fake_oauth_states_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox"."pg_fake_posts" ADD CONSTRAINT "pg_fake_posts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox"."pg_fake_selections" ADD CONSTRAINT "pg_fake_selections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_fake_budgets_account_id_idx" ON "sandbox"."ai_fake_budgets" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_fake_budgets_cycle_key" ON "sandbox"."ai_fake_budgets" USING btree ("account_id","cycle_start");--> statement-breakpoint
CREATE INDEX "ai_fake_cost_ledger_account_id_idx" ON "sandbox"."ai_fake_cost_ledger" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ai_fake_cost_ledger_account_cycle_idx" ON "sandbox"."ai_fake_cost_ledger" USING btree ("account_id","cycle_start");--> statement-breakpoint
CREATE INDEX "ai_fake_reservations_account_id_idx" ON "sandbox"."ai_fake_reservations" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ai_fake_reservations_account_state_idx" ON "sandbox"."ai_fake_reservations" USING btree ("account_id","state","reserved_at");--> statement-breakpoint
CREATE INDEX "ai_fake_system_cost_ledger_week_idx" ON "sandbox"."ai_fake_system_cost_ledger" USING btree ("week_start");--> statement-breakpoint
CREATE INDEX "ai_fake_system_reservations_state_idx" ON "sandbox"."ai_fake_system_reservations" USING btree ("state","reserved_at");--> statement-breakpoint
CREATE INDEX "fake_scenarios_account_id_idx" ON "sandbox"."fake_scenarios" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "fake_scenarios_account_component_target_idx" ON "sandbox"."fake_scenarios" USING btree ("account_id","component","target");--> statement-breakpoint
CREATE INDEX "ntf_fake_events_account_id_idx" ON "sandbox"."ntf_fake_events" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ntf_fake_events_dedupe_key" ON "sandbox"."ntf_fake_events" USING btree ("account_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "ntf_fake_notifications_account_id_idx" ON "sandbox"."ntf_fake_notifications" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ntf_fake_notifications_recipient_key" ON "sandbox"."ntf_fake_notifications" USING btree ("account_id","dedupe_key","recipient_user_id","channel");--> statement-breakpoint
CREATE INDEX "pg_fake_connections_account_id_idx" ON "sandbox"."pg_fake_connections" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pg_fake_connections_live_key" ON "sandbox"."pg_fake_connections" USING btree ("account_id","channel_type","external_id") WHERE status <> 'disconnected';--> statement-breakpoint
CREATE INDEX "pg_fake_oauth_states_account_id_idx" ON "sandbox"."pg_fake_oauth_states" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pg_fake_oauth_states_state_hash_key" ON "sandbox"."pg_fake_oauth_states" USING btree ("account_id","state_hash");--> statement-breakpoint
CREATE INDEX "pg_fake_posts_account_id_idx" ON "sandbox"."pg_fake_posts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "pg_fake_posts_account_connection_hash_idx" ON "sandbox"."pg_fake_posts" USING btree ("account_id","connection_id","content_hash");--> statement-breakpoint
CREATE INDEX "pg_fake_selections_account_id_idx" ON "sandbox"."pg_fake_selections" USING btree ("account_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sandbox"."ai_fake_budgets" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sandbox"."ai_fake_cost_ledger" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sandbox"."ai_fake_reservations" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sandbox"."fake_scenarios" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sandbox"."ntf_fake_events" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sandbox"."ntf_fake_notifications" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sandbox"."pg_fake_connections" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sandbox"."pg_fake_oauth_states" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sandbox"."pg_fake_posts" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sandbox"."pg_fake_selections" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());
--> statement-breakpoint
-- Bảng tenant: app (API) + system (Worker), cùng chịu chính sách tenant_isolation.
GRANT SELECT, INSERT, UPDATE, DELETE ON sandbox.fake_scenarios, sandbox.pg_fake_oauth_states, sandbox.pg_fake_selections, sandbox.pg_fake_connections, sandbox.pg_fake_posts, sandbox.ai_fake_budgets, sandbox.ai_fake_reservations, sandbox.ai_fake_cost_ledger, sandbox.ntf_fake_events, sandbox.ntf_fake_notifications TO "app", "system";
--> statement-breakpoint
-- Bảng hệ thống (ngân sách AI theo tuần): CHỈ vai trò system (Worker) – tenant không đọc/ghi được.
GRANT SELECT, INSERT, UPDATE ON sandbox.ai_fake_system_budgets, sandbox.ai_fake_system_reservations, sandbox.ai_fake_system_cost_ledger TO "system";
