CREATE TABLE "publishing"."error_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel_type" text NOT NULL,
	"raw_code" text NOT NULL,
	"category" text NOT NULL,
	"message_vi" text NOT NULL,
	"remedies" jsonb NOT NULL,
	"needs_reason" text,
	"retry_after_sec" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "error_mappings_category_check" CHECK ("publishing"."error_mappings"."category" IN ('transient', 'user_action', 'unknown')),
	CONSTRAINT "error_mappings_message_length" CHECK (char_length("publishing"."error_mappings"."message_vi") <= 500),
	CONSTRAINT "error_mappings_remedies_nonempty" CHECK (jsonb_array_length("publishing"."error_mappings"."remedies") >= 1),
	CONSTRAINT "error_mappings_retry_after_check" CHECK ("publishing"."error_mappings"."retry_after_sec" IS NULL OR ("publishing"."error_mappings"."category" = 'transient' AND "publishing"."error_mappings"."retry_after_sec" > 0))
);
--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "phase" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "run_no" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "transient_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "transient_window_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "reconcile_retry_used" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "processing_id" text;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "platform_post_id" text;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "permalink" text;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "confirmed_by" text;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "needs_reason" text;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "last_error_category" text;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "last_raw_code" text;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD COLUMN "trace_id" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "error_mappings_channel_code_key" ON "publishing"."error_mappings" USING btree ("channel_type","raw_code");--> statement-breakpoint
-- breaking-ok: bảng publish_attempts còn rất nhỏ (012 chưa có bộ thực thi thật), dựng chỉ mục trong giao dịch an toàn
CREATE INDEX "publish_attempts_status_scheduled_idx" ON "publishing"."publish_attempts" USING btree ("account_id","status","scheduled_at");--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD CONSTRAINT "publish_attempts_phase_check" CHECK ("publishing"."publish_attempts"."phase" IN ('none', 'submitted_awaiting_response', 'awaiting_processing', 'finished')) NOT VALID;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" VALIDATE CONSTRAINT "publish_attempts_phase_check";--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD CONSTRAINT "publish_attempts_transient_attempts_check" CHECK ("publishing"."publish_attempts"."transient_attempts" BETWEEN 0 AND 5) NOT VALID;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" VALIDATE CONSTRAINT "publish_attempts_transient_attempts_check";--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD CONSTRAINT "publish_attempts_confirmed_by_check" CHECK ("publishing"."publish_attempts"."confirmed_by" IS NULL OR "publishing"."publish_attempts"."confirmed_by" IN ('platform', 'reconciliation', 'user')) NOT VALID;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" VALIDATE CONSTRAINT "publish_attempts_confirmed_by_check";--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD CONSTRAINT "publish_attempts_last_error_category_check" CHECK ("publishing"."publish_attempts"."last_error_category" IS NULL OR "publishing"."publish_attempts"."last_error_category" IN ('transient', 'user_action', 'unknown')) NOT VALID;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" VALIDATE CONSTRAINT "publish_attempts_last_error_category_check";--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD CONSTRAINT "publish_attempts_permalink_length" CHECK ("publishing"."publish_attempts"."permalink" IS NULL OR char_length("publishing"."publish_attempts"."permalink") <= 2048) NOT VALID;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" VALIDATE CONSTRAINT "publish_attempts_permalink_length";--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD CONSTRAINT "publish_attempts_needs_reason_check" CHECK (("publishing"."publish_attempts"."status" IN ('needs_user', 'needs_check')) = ("publishing"."publish_attempts"."needs_reason" IS NOT NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" VALIDATE CONSTRAINT "publish_attempts_needs_reason_check";--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD CONSTRAINT "publish_attempts_finished_phase_check" CHECK ("publishing"."publish_attempts"."phase" <> 'finished' OR "publishing"."publish_attempts"."status" IN ('succeeded', 'cancelled')) NOT VALID;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" VALIDATE CONSTRAINT "publish_attempts_finished_phase_check";--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD CONSTRAINT "publish_attempts_succeeded_proof_check" CHECK ("publishing"."publish_attempts"."status" <> 'succeeded' OR "publishing"."publish_attempts"."platform_post_id" IS NOT NULL OR "publishing"."publish_attempts"."confirmed_by" = 'user') NOT VALID;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" VALIDATE CONSTRAINT "publish_attempts_succeeded_proof_check";--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" ADD CONSTRAINT "publish_attempts_submitted_stamp_check" CHECK ("publishing"."publish_attempts"."phase" <> 'submitted_awaiting_response' OR ("publishing"."publish_attempts"."content_hash" IS NOT NULL AND "publishing"."publish_attempts"."submitted_at" IS NOT NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "publishing"."publish_attempts" VALIDATE CONSTRAINT "publish_attempts_submitted_stamp_check";