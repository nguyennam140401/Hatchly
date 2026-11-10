CREATE TABLE "infra"."schedule_slots" (
	"name" text NOT NULL,
	"slot" text NOT NULL,
	"slot_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"job_id" uuid,
	"late_seconds" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_slots_pkey" PRIMARY KEY("name","slot"),
	CONSTRAINT "schedule_slots_status_check" CHECK (status IN ('enqueued', 'skipped_overlap'))
);
--> statement-breakpoint
CREATE INDEX "schedule_slots_slot_at_idx" ON "infra"."schedule_slots" USING btree ("slot_at");
--> statement-breakpoint
-- ===================== Phần viết tay (003 data-model mục 6, 8) =====================
-- Chỉ bộ hẹn giờ của Worker (vai trò system) đọc/ghi khung lịch; app/support không có quyền.
GRANT SELECT, INSERT, UPDATE, DELETE ON infra.schedule_slots TO "system";
--> statement-breakpoint
-- Bỏ phân vùng audit_log đã kết thúc trước đầu tháng (UTC) hiện tại − `months` tháng (giữ 12 tháng –
-- hiến pháp VII: nhật ký duyệt/đăng giữ 12 tháng). Idempotent. Trả số phân vùng đã bỏ.
CREATE OR REPLACE FUNCTION infra.drop_audit_log_partitions_before(months int) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, infra
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
     WHERE n2.nspname = 'infra' AND p.relname = 'audit_log'
  LOOP
    -- bound: FOR VALUES FROM ('…') TO ('…')
    upper_bound := substring(part.bound FROM 'TO \(''([^'']+)''\)')::timestamptz;
    IF upper_bound IS NOT NULL AND upper_bound <= cutoff THEN
      EXECUTE format('DROP TABLE infra.%I', part.name);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION infra.drop_audit_log_partitions_before(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION infra.drop_audit_log_partitions_before(int) TO "system";
