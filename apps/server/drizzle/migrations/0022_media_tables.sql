CREATE TABLE "media"."media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"display_name" text NOT NULL,
	"original_content_type" text NOT NULL,
	"original_bytes" bigint NOT NULL,
	"file_hash" char(64),
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"normalized_bytes" bigint,
	"thumb_bytes" bigint,
	"uploaded_by_user_id" uuid NOT NULL,
	"failure_code" text,
	"processed_at" timestamp with time zone,
	"files_purged_at" timestamp with time zone,
	CONSTRAINT "media_kind_check" CHECK ("media"."media"."kind" IN ('image', 'video')),
	CONSTRAINT "media_status_check" CHECK ("media"."media"."status" IN ('uploading', 'processing', 'ready', 'unprocessable')),
	CONSTRAINT "media_display_name_length" CHECK (char_length("media"."media"."display_name") BETWEEN 1 AND 255),
	CONSTRAINT "media_original_bytes_positive" CHECK ("media"."media"."original_bytes" > 0),
	CONSTRAINT "media_file_hash_format" CHECK ("media"."media"."file_hash" IS NULL OR "media"."media"."file_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_duration_video_only" CHECK ("media"."media"."kind" = 'video' OR "media"."media"."duration_ms" IS NULL),
	CONSTRAINT "media_ready_complete" CHECK ("media"."media"."status" <> 'ready' OR ("media"."media"."file_hash" IS NOT NULL AND "media"."media"."width" IS NOT NULL AND "media"."media"."height" IS NOT NULL AND "media"."media"."processed_at" IS NOT NULL)),
	CONSTRAINT "media_ready_image_normalized" CHECK ("media"."media"."status" <> 'ready' OR "media"."media"."kind" <> 'image' OR "media"."media"."normalized_bytes" IS NOT NULL),
	CONSTRAINT "media_ready_thumb" CHECK ("media"."media"."status" <> 'ready' OR "media"."media"."thumb_bytes" IS NOT NULL),
	CONSTRAINT "media_unprocessable_failure_code" CHECK ("media"."media"."status" <> 'unprocessable' OR "media"."media"."failure_code" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "media"."media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media"."storage_quotas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"limit_bytes" bigint NOT NULL,
	CONSTRAINT "storage_quotas_limit_positive" CHECK ("media"."storage_quotas"."limit_bytes" > 0),
	CONSTRAINT "storage_quotas_within_limit" CHECK ("media"."storage_quotas"."used_bytes" >= 0 AND "media"."storage_quotas"."reserved_bytes" >= 0 AND "media"."storage_quotas"."used_bytes" + "media"."storage_quotas"."reserved_bytes" <= "media"."storage_quotas"."limit_bytes")
);
--> statement-breakpoint
ALTER TABLE "media"."storage_quotas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media"."upload_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"media_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"fingerprint" char(64) NOT NULL,
	"mode" text NOT NULL,
	"declared_bytes" bigint NOT NULL,
	"declared_content_type" text NOT NULL,
	"multipart_upload_id" text,
	"part_size_bytes" integer,
	"part_count" integer,
	"state" text DEFAULT 'open' NOT NULL,
	"failure_code" text,
	"duplicate_of_media_id" uuid,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "upload_sessions_fingerprint_format" CHECK ("media"."upload_sessions"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "upload_sessions_mode_check" CHECK ("media"."upload_sessions"."mode" IN ('single', 'multipart')),
	CONSTRAINT "upload_sessions_declared_bytes_positive" CHECK ("media"."upload_sessions"."declared_bytes" > 0),
	CONSTRAINT "upload_sessions_state_check" CHECK ("media"."upload_sessions"."state" IN ('open', 'completing', 'completed', 'cancelled', 'expired', 'failed', 'duplicate')),
	CONSTRAINT "upload_sessions_failure_code_check" CHECK ("media"."upload_sessions"."failure_code" IS NULL OR "media"."upload_sessions"."failure_code" IN ('size_mismatch', 'type_mismatch', 'type_unsupported', 'animated', 'missing_object', 'plan_expired')),
	CONSTRAINT "upload_sessions_multipart_shape" CHECK (("media"."upload_sessions"."mode" = 'multipart' AND "media"."upload_sessions"."part_size_bytes" IS NOT NULL AND "media"."upload_sessions"."part_count" IS NOT NULL) OR ("media"."upload_sessions"."mode" = 'single' AND "media"."upload_sessions"."multipart_upload_id" IS NULL AND "media"."upload_sessions"."part_count" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "media"."upload_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media"."media" ADD CONSTRAINT "media_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media"."storage_quotas" ADD CONSTRAINT "storage_quotas_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media"."upload_sessions" ADD CONSTRAINT "upload_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media"."upload_sessions" ADD CONSTRAINT "upload_sessions_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "media"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_account_id_idx" ON "media"."media" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_account_file_hash_key" ON "media"."media" USING btree ("account_id","file_hash") WHERE "media"."media"."file_hash" IS NOT NULL AND "media"."media"."deleted_at" IS NULL AND "media"."media"."status" IN ('processing', 'ready');--> statement-breakpoint
CREATE INDEX "media_account_created_idx" ON "media"."media" USING btree ("account_id","created_at" DESC,"id") WHERE "media"."media"."deleted_at" IS NULL AND "media"."media"."status" <> 'uploading';--> statement-breakpoint
CREATE INDEX "media_account_kind_created_idx" ON "media"."media" USING btree ("account_id","kind","created_at" DESC) WHERE "media"."media"."deleted_at" IS NULL AND "media"."media"."status" <> 'uploading';--> statement-breakpoint
CREATE INDEX "media_account_uploader_idx" ON "media"."media" USING btree ("account_id","uploaded_by_user_id");--> statement-breakpoint
CREATE INDEX "storage_quotas_account_id_idx" ON "media"."storage_quotas" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_quotas_account_id_key" ON "media"."storage_quotas" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_account_id_idx" ON "media"."upload_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_sessions_active_fingerprint_key" ON "media"."upload_sessions" USING btree ("account_id","created_by_user_id","fingerprint") WHERE "media"."upload_sessions"."state" IN ('open', 'completing');--> statement-breakpoint
CREATE INDEX "upload_sessions_account_expires_idx" ON "media"."upload_sessions" USING btree ("account_id","expires_at") WHERE "media"."upload_sessions"."state" = 'open';--> statement-breakpoint
CREATE INDEX "upload_sessions_account_media_idx" ON "media"."upload_sessions" USING btree ("account_id","media_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "media"."media" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "media"."storage_quotas" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "media"."upload_sessions" AS PERMISSIVE FOR ALL TO "app", "system" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());