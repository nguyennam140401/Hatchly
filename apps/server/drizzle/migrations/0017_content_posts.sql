CREATE TABLE "content"."channel_rules" (
	"channel_type" text PRIMARY KEY NOT NULL,
	"max_text_length" integer NOT NULL,
	"max_hashtags" integer,
	"media_required" boolean DEFAULT false NOT NULL,
	"max_posts_per_24h" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_rules_max_text_length_check" CHECK ("content"."channel_rules"."max_text_length" >= 1),
	CONSTRAINT "channel_rules_max_hashtags_check" CHECK ("content"."channel_rules"."max_hashtags" IS NULL OR "content"."channel_rules"."max_hashtags" >= 0),
	CONSTRAINT "channel_rules_max_posts_check" CHECK ("content"."channel_rules"."max_posts_per_24h" IS NULL OR "content"."channel_rules"."max_posts_per_24h" >= 1)
);
--> statement-breakpoint
CREATE TABLE "content"."channel_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"post_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"channel_type" text NOT NULL,
	"customized" boolean DEFAULT false NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "channel_variants_channel_type_check" CHECK ("content"."channel_variants"."channel_type" IN ('facebook_page', 'instagram', 'zalo_oa', 'test_channel')),
	CONSTRAINT "channel_variants_text_length" CHECK (char_length("content"."channel_variants"."text") <= 63206),
	CONSTRAINT "channel_variants_hashtags_count" CHECK (cardinality("content"."channel_variants"."hashtags") <= 30),
	CONSTRAINT "channel_variants_hashtags_no_space" CHECK (array_to_string("content"."channel_variants"."hashtags", ',') !~ '\s'),
	CONSTRAINT "channel_variants_media_shape" CHECK (jsonb_typeof("content"."channel_variants"."media") = 'array' AND jsonb_array_length("content"."channel_variants"."media") <= 20)
);
--> statement-breakpoint
ALTER TABLE "content"."channel_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content"."post_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"post_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "post_events_type_check" CHECK ("content"."post_events"."type" IN ('created', 'submitted', 'withdrawn', 'approved', 'returned', 'unscheduled', 'rescheduled', 'edited_after_approval', 'channels_changed'))
);
--> statement-breakpoint
ALTER TABLE "content"."post_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content"."posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"internal_name" varchar(80),
	"shared_text" text DEFAULT '' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"submission_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"returned_note" varchar(500),
	"returned_by" uuid,
	"returned_at" timestamp with time zone,
	"edited_after_approval" boolean DEFAULT false NOT NULL,
	CONSTRAINT "posts_status_check" CHECK ("content"."posts"."status" IN ('draft', 'pending_review', 'approved', 'cancelled')),
	CONSTRAINT "posts_source_check" CHECK ("content"."posts"."source" IN ('manual', 'ai')),
	CONSTRAINT "posts_shared_text_length" CHECK (char_length("content"."posts"."shared_text") <= 63206),
	CONSTRAINT "posts_approved_has_schedule" CHECK ("content"."posts"."status" <> 'approved' OR ("content"."posts"."scheduled_at" IS NOT NULL AND "content"."posts"."approved_by" IS NOT NULL AND "content"."posts"."approved_at" IS NOT NULL)),
	CONSTRAINT "posts_returned_note_length" CHECK ("content"."posts"."returned_note" IS NULL OR char_length(btrim("content"."posts"."returned_note")) BETWEEN 1 AND 500),
	CONSTRAINT "posts_pending_has_submitter" CHECK ("content"."posts"."status" <> 'pending_review' OR "content"."posts"."submitted_by" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "content"."posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "publishing"."publish_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"post_id" uuid NOT NULL,
	"channel_connection_id" uuid NOT NULL,
	"channel_type" text NOT NULL,
	"status" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"content_version" integer NOT NULL,
	CONSTRAINT "publish_attempts_status_check" CHECK ("publishing"."publish_attempts"."status" IN ('scheduled', 'processing', 'retry_wait', 'needs_user', 'unknown', 'needs_check', 'succeeded', 'cancelled')),
	CONSTRAINT "publish_attempts_content_version_check" CHECK ("publishing"."publish_attempts"."content_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content"."channel_variants" ADD CONSTRAINT "channel_variants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."channel_variants" ADD CONSTRAINT "channel_variants_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "content"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."post_events" ADD CONSTRAINT "post_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."post_events" ADD CONSTRAINT "post_events_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "content"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."posts" ADD CONSTRAINT "posts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD CONSTRAINT "publish_attempts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_variants_account_id_idx" ON "content"."channel_variants" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_variants_account_post_connection_key" ON "content"."channel_variants" USING btree ("account_id","post_id","connection_id");--> statement-breakpoint
CREATE INDEX "channel_variants_account_post_idx" ON "content"."channel_variants" USING btree ("account_id","post_id");--> statement-breakpoint
CREATE INDEX "post_events_account_id_idx" ON "content"."post_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "post_events_account_post_occurred_idx" ON "content"."post_events" USING btree ("account_id","post_id","occurred_at");--> statement-breakpoint
CREATE INDEX "posts_account_id_idx" ON "content"."posts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "posts_account_status_scheduled_idx" ON "content"."posts" USING btree ("account_id","status","scheduled_at") WHERE "content"."posts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "posts_account_scheduled_idx" ON "content"."posts" USING btree ("account_id","scheduled_at") WHERE "content"."posts"."deleted_at" IS NULL AND "content"."posts"."scheduled_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "posts_account_created_idx" ON "content"."posts" USING btree ("account_id","created_at" DESC,"id") WHERE "content"."posts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "posts_account_submission_idx" ON "content"."posts" USING btree ("account_id","submission_id") WHERE "content"."posts"."submission_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "publish_attempts_account_id_idx" ON "publishing"."publish_attempts" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publish_attempts_effective_key" ON "publishing"."publish_attempts" USING btree ("account_id","post_id","channel_connection_id") WHERE "publishing"."publish_attempts"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "publish_attempts_scheduled_idx" ON "publishing"."publish_attempts" USING btree ("account_id","scheduled_at") WHERE "publishing"."publish_attempts"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "publish_attempts_post_idx" ON "publishing"."publish_attempts" USING btree ("account_id","post_id");--> statement-breakpoint
CREATE INDEX "publish_attempts_quota_idx" ON "publishing"."publish_attempts" USING btree ("account_id","channel_connection_id","scheduled_at") WHERE "publishing"."publish_attempts"."status" <> 'cancelled';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "content"."channel_variants" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "content"."post_events" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "content"."posts" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "publishing"."publish_attempts" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());