CREATE TABLE "infra"."smoke_pings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"api_version" text NOT NULL,
	"processed_at" timestamp with time zone,
	"worker_version" text
);
--> statement-breakpoint
CREATE INDEX "smoke_pings_requested_at_idx" ON "infra"."smoke_pings" USING btree ("requested_at");--> statement-breakpoint
-- ===================== Phần viết tay (008 FR-032, R20) =====================
-- Bảng dùng chung, không có dữ liệu khách hàng. `app` ghi + đọc (API, qua authTx không tenant); `system` chỉ
-- được đánh dấu đã xử lý (hai cột) + đọc + dọn dòng cũ; `support` KHÔNG có quyền.
GRANT SELECT, INSERT ON infra.smoke_pings TO "app";
--> statement-breakpoint
GRANT SELECT, DELETE ON infra.smoke_pings TO "system";
--> statement-breakpoint
GRANT UPDATE (processed_at, worker_version) ON infra.smoke_pings TO "system";
--> statement-breakpoint
-- Việc `queue.smoke_ping` là việc HỆ THỐNG (group_id rỗng) do API tạo bằng vai `app` (FR-032). Chính sách RLS của
-- 0005 chỉ cho `app` ghi việc của tenant hiện hành, nên thêm hai chính sách HẸP, chỉ cho đúng loại việc này:
-- INSERT và SELECT (RETURNING của pg-boss cần SELECT). `app` vẫn KHÔNG ghi được việc hệ thống loại khác và vẫn
-- không thấy việc của tenant nào; vai `system` không đổi.
CREATE POLICY queue_smoke_ping_insert ON pgboss.job AS PERMISSIVE FOR INSERT TO "app"
  WITH CHECK (group_id IS NULL AND name = 'notify' AND data->>'type' = 'queue.smoke_ping');
--> statement-breakpoint
CREATE POLICY queue_smoke_ping_select ON pgboss.job AS PERMISSIVE FOR SELECT TO "app"
  USING (group_id IS NULL AND name = 'notify' AND data->>'type' = 'queue.smoke_ping');
--> statement-breakpoint
CREATE POLICY queue_smoke_ping_insert ON pgboss.job_common AS PERMISSIVE FOR INSERT TO "app"
  WITH CHECK (group_id IS NULL AND name = 'notify' AND data->>'type' = 'queue.smoke_ping');
--> statement-breakpoint
CREATE POLICY queue_smoke_ping_select ON pgboss.job_common AS PERMISSIVE FOR SELECT TO "app"
  USING (group_id IS NULL AND name = 'notify' AND data->>'type' = 'queue.smoke_ping');
