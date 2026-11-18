CREATE TABLE "platform_gateway"."channel_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"channel_type" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"avatar_url" text,
	"account_type" text,
	"granted_scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"quota_remaining" integer,
	"source_connection_id" uuid,
	"token_ciphertext" "bytea",
	"refresh_ciphertext" "bytea",
	"token_issued_at" timestamp with time zone NOT NULL,
	"expiry_kind" text DEFAULT 'token' NOT NULL,
	"token_expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"reason_code" text,
	"last_error_code" text,
	"last_checked_at" timestamp with time zone,
	"last_refreshed_at" timestamp with time zone,
	"last_manual_check_at" timestamp with time zone,
	"recheck_required" boolean DEFAULT false NOT NULL,
	"last_notified_stage" text,
	"connected_at" timestamp with time zone NOT NULL,
	"disconnected_at" timestamp with time zone,
	CONSTRAINT "channel_connections_channel_type_check" CHECK ("platform_gateway"."channel_connections"."channel_type" IN ('facebook_page', 'instagram', 'tiktok', 'zalo_oa', 'test_channel')),
	CONSTRAINT "channel_connections_status_check" CHECK ("platform_gateway"."channel_connections"."status" IN ('active', 'needs_reconnect', 'ineligible', 'disconnected')),
	CONSTRAINT "channel_connections_expiry_kind_check" CHECK ("platform_gateway"."channel_connections"."expiry_kind" IN ('none', 'token', 'data_access')),
	CONSTRAINT "channel_connections_last_notified_stage_check" CHECK ("platform_gateway"."channel_connections"."last_notified_stage" IS NULL OR "platform_gateway"."channel_connections"."last_notified_stage" IN ('d7', 'd1', 'expired')),
	CONSTRAINT "channel_connections_disconnected_check" CHECK (("platform_gateway"."channel_connections"."status" = 'disconnected') = ("platform_gateway"."channel_connections"."disconnected_at" IS NOT NULL)),
	CONSTRAINT "channel_connections_expiry_check" CHECK (("platform_gateway"."channel_connections"."expiry_kind" = 'none') = ("platform_gateway"."channel_connections"."token_expires_at" IS NULL)),
	CONSTRAINT "channel_connections_source_only_instagram" CHECK ("platform_gateway"."channel_connections"."channel_type" = 'instagram' OR "platform_gateway"."channel_connections"."source_connection_id" IS NULL),
	CONSTRAINT "channel_connections_source_not_self" CHECK ("platform_gateway"."channel_connections"."source_connection_id" IS DISTINCT FROM "platform_gateway"."channel_connections"."id"),
	CONSTRAINT "channel_connections_token_present" CHECK (("platform_gateway"."channel_connections"."status" = 'disconnected') OR "platform_gateway"."channel_connections"."token_ciphertext" IS NOT NULL),
	CONSTRAINT "channel_connections_disconnected_no_token" CHECK ("platform_gateway"."channel_connections"."status" <> 'disconnected' OR ("platform_gateway"."channel_connections"."token_ciphertext" IS NULL AND "platform_gateway"."channel_connections"."refresh_ciphertext" IS NULL)),
	CONSTRAINT "channel_connections_external_id_length" CHECK (char_length("platform_gateway"."channel_connections"."external_id") BETWEEN 1 AND 200),
	CONSTRAINT "channel_connections_avatar_url_check" CHECK ("platform_gateway"."channel_connections"."avatar_url" IS NULL OR ("platform_gateway"."channel_connections"."avatar_url" ~ '^https://' AND char_length("platform_gateway"."channel_connections"."avatar_url") <= 500)),
	CONSTRAINT "channel_connections_reason_code_check" CHECK ("platform_gateway"."channel_connections"."reason_code" IS NULL OR "platform_gateway"."channel_connections"."reason_code" ~ '^[A-Za-z0-9_.:-]{1,64}$'),
	CONSTRAINT "channel_connections_last_error_code_check" CHECK ("platform_gateway"."channel_connections"."last_error_code" IS NULL OR "platform_gateway"."channel_connections"."last_error_code" ~ '^[A-Za-z0-9_.:-]{1,64}$')
);
--> statement-breakpoint
ALTER TABLE "platform_gateway"."channel_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_gateway"."connect_selections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_type" text NOT NULL,
	"candidates" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "connect_selections_channel_type_check" CHECK ("platform_gateway"."connect_selections"."channel_type" IN ('facebook_page', 'instagram', 'tiktok')),
	CONSTRAINT "connect_selections_candidates_check" CHECK (jsonb_typeof("platform_gateway"."connect_selections"."candidates") = 'array' AND jsonb_array_length("platform_gateway"."connect_selections"."candidates") <= 100)
);
--> statement-breakpoint
ALTER TABLE "platform_gateway"."connect_selections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_gateway"."connect_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_hash" "bytea" NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_type" text NOT NULL,
	"reconnect_connection_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "connect_states_channel_type_check" CHECK ("platform_gateway"."connect_states"."channel_type" IN ('facebook_page', 'instagram', 'tiktok'))
);
--> statement-breakpoint
ALTER TABLE "platform_gateway"."connect_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_gateway"."feature_override_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"flag_key" text NOT NULL,
	"old_value" text NOT NULL,
	"new_value" text NOT NULL,
	"reason" varchar(500) NOT NULL,
	"changed_by_staff_id" uuid NOT NULL,
	"trace_id" text NOT NULL,
	CONSTRAINT "feature_override_events_flag_key_check" CHECK ("platform_gateway"."feature_override_events"."flag_key" IN ('channel.tiktok')),
	CONSTRAINT "feature_override_events_values_check" CHECK ("platform_gateway"."feature_override_events"."old_value" IN ('on', 'off', 'default') AND "platform_gateway"."feature_override_events"."new_value" IN ('on', 'off', 'default'))
);
--> statement-breakpoint
ALTER TABLE "platform_gateway"."feature_override_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_gateway"."feature_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"flag_key" text NOT NULL,
	"value" boolean NOT NULL,
	"reason" varchar(500) NOT NULL,
	"changed_by_staff_id" uuid NOT NULL,
	CONSTRAINT "feature_overrides_flag_key_check" CHECK ("platform_gateway"."feature_overrides"."flag_key" IN ('channel.tiktok')),
	CONSTRAINT "feature_overrides_reason_check" CHECK (char_length("platform_gateway"."feature_overrides"."reason") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "platform_gateway"."feature_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_gateway"."gateway_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "platform_gateway"."channel_connections" ADD CONSTRAINT "channel_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_gateway"."channel_connections" ADD CONSTRAINT "channel_connections_source_fk" FOREIGN KEY ("source_connection_id") REFERENCES "platform_gateway"."channel_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_gateway"."connect_selections" ADD CONSTRAINT "connect_selections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_gateway"."connect_states" ADD CONSTRAINT "connect_states_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_gateway"."connect_states" ADD CONSTRAINT "connect_states_reconnect_connection_id_channel_connections_id_fk" FOREIGN KEY ("reconnect_connection_id") REFERENCES "platform_gateway"."channel_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_gateway"."feature_override_events" ADD CONSTRAINT "feature_override_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_gateway"."feature_overrides" ADD CONSTRAINT "feature_overrides_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_connections_account_id_idx" ON "platform_gateway"."channel_connections" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connections_channel_external_active_key" ON "platform_gateway"."channel_connections" USING btree ("channel_type","external_id") WHERE "platform_gateway"."channel_connections"."status" <> 'disconnected';--> statement-breakpoint
CREATE INDEX "channel_connections_account_type_idx" ON "platform_gateway"."channel_connections" USING btree ("account_id","channel_type") WHERE "platform_gateway"."channel_connections"."status" <> 'disconnected';--> statement-breakpoint
CREATE INDEX "channel_connections_source_idx" ON "platform_gateway"."channel_connections" USING btree ("account_id","source_connection_id") WHERE "platform_gateway"."channel_connections"."source_connection_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "channel_connections_due_expiry_idx" ON "platform_gateway"."channel_connections" USING btree ("token_expires_at") WHERE "platform_gateway"."channel_connections"."status" = 'active';--> statement-breakpoint
CREATE INDEX "channel_connections_due_checked_idx" ON "platform_gateway"."channel_connections" USING btree ("last_checked_at") WHERE "platform_gateway"."channel_connections"."status" = 'active';--> statement-breakpoint
CREATE INDEX "connect_selections_account_id_idx" ON "platform_gateway"."connect_selections" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "connect_selections_account_expires_idx" ON "platform_gateway"."connect_selections" USING btree ("account_id","expires_at");--> statement-breakpoint
CREATE INDEX "connect_states_account_id_idx" ON "platform_gateway"."connect_states" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connect_states_account_state_hash_key" ON "platform_gateway"."connect_states" USING btree ("account_id","state_hash");--> statement-breakpoint
CREATE INDEX "connect_states_account_expires_idx" ON "platform_gateway"."connect_states" USING btree ("account_id","expires_at");--> statement-breakpoint
CREATE INDEX "feature_override_events_account_id_idx" ON "platform_gateway"."feature_override_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "feature_override_events_account_created_idx" ON "platform_gateway"."feature_override_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "feature_overrides_account_id_idx" ON "platform_gateway"."feature_overrides" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_overrides_account_flag_key" ON "platform_gateway"."feature_overrides" USING btree ("account_id","flag_key");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "platform_gateway"."channel_connections" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "platform_gateway"."connect_selections" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "platform_gateway"."connect_states" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "platform_gateway"."feature_override_events" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "platform_gateway"."feature_overrides" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());