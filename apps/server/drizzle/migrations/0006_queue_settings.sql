CREATE TABLE "infra"."queue_settings" (
	"queue" text PRIMARY KEY NOT NULL,
	"concurrency_per_worker" integer NOT NULL,
	"max_per_tenant" integer,
	"lock_seconds" integer NOT NULL,
	"heartbeat_seconds" integer NOT NULL,
	"retry_mode" text NOT NULL,
	"max_retries" integer NOT NULL,
	"retry_delays_seconds" integer[] NOT NULL,
	"poll_interval_ms" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "queue_settings_queue_check" CHECK ("infra"."queue_settings"."queue" IN ('publish', 'media', 'ai_batch', 'trends', 'notify', 'scheduled')),
	CONSTRAINT "queue_settings_concurrency_check" CHECK ("infra"."queue_settings"."concurrency_per_worker" >= 1 AND "infra"."queue_settings"."concurrency_per_worker" <= 50),
	CONSTRAINT "queue_settings_max_per_tenant_check" CHECK ("infra"."queue_settings"."max_per_tenant" IS NULL OR ("infra"."queue_settings"."max_per_tenant" >= 1 AND "infra"."queue_settings"."max_per_tenant" <= "infra"."queue_settings"."concurrency_per_worker" * 10)),
	CONSTRAINT "queue_settings_lock_seconds_check" CHECK ("infra"."queue_settings"."lock_seconds" >= 30 AND "infra"."queue_settings"."lock_seconds" <= 3600),
	CONSTRAINT "queue_settings_heartbeat_seconds_check" CHECK ("infra"."queue_settings"."heartbeat_seconds" >= 10 AND "infra"."queue_settings"."heartbeat_seconds" < "infra"."queue_settings"."lock_seconds"),
	CONSTRAINT "queue_settings_retry_mode_check" CHECK ("infra"."queue_settings"."retry_mode" IN ('schedule', 'handler', 'none')),
	CONSTRAINT "queue_settings_max_retries_check" CHECK ("infra"."queue_settings"."max_retries" >= 0 AND "infra"."queue_settings"."max_retries" <= 20 AND ("infra"."queue_settings"."retry_mode" <> 'none' OR "infra"."queue_settings"."max_retries" = 0)),
	CONSTRAINT "queue_settings_retry_delays_check" CHECK (cardinality("infra"."queue_settings"."retry_delays_seconds") >= 1 AND array_position("infra"."queue_settings"."retry_delays_seconds", NULL) IS NULL AND 1 <= ALL("infra"."queue_settings"."retry_delays_seconds") AND 86400 >= ALL("infra"."queue_settings"."retry_delays_seconds")),
	CONSTRAINT "queue_settings_poll_interval_check" CHECK ("infra"."queue_settings"."poll_interval_ms" >= 200 AND "infra"."queue_settings"."poll_interval_ms" <= 60000)
);

--> statement-breakpoint
-- Phần viết tay (003 data-model mục 4): khởi tạo 6 dòng theo bảng "Key Entities" của spec. Đổi giá trị
-- sau này bằng UPDATE (Worker áp dụng ≤ 60 giây, không cần phát hành) – không sửa migration này.
INSERT INTO infra.queue_settings
  (queue, concurrency_per_worker, max_per_tenant, lock_seconds, heartbeat_seconds, retry_mode,
   max_retries, retry_delays_seconds, poll_interval_ms, updated_by)
VALUES
  ('publish',   10, 3,    120, 30, 'handler',  5, '{60}',                 1000, 'migration'),
  ('media',      2, 1,    900, 30, 'schedule', 3, '{60,300,900}',         5000, 'migration'),
  ('ai_batch',   5, 3,    180, 30, 'schedule', 2, '{30,120}',             2000, 'migration'),
  ('trends',     2, 1,    600, 30, 'schedule', 3, '{3600,14400}',         5000, 'migration'),
  ('notify',     5, NULL,  60, 30, 'schedule', 5, '{30,60,120,300,600}',  2000, 'migration'),
  ('scheduled',  2, NULL, 600, 30, 'none',     0, '{60}',                 2000, 'migration');
--> statement-breakpoint
-- infra không có quyền mặc định (0000): app chỉ đọc, system đọc + sửa (công cụ quản trị qua module sau
-- này). Không ai ngoài owner INSERT/DELETE – 6 dòng cố định.
GRANT SELECT ON infra.queue_settings TO "app";
--> statement-breakpoint
GRANT SELECT, UPDATE ON infra.queue_settings TO "system";
