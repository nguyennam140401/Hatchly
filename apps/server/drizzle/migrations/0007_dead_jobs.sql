CREATE TABLE "infra"."dead_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"original_job_id" uuid NOT NULL,
	"queue" text NOT NULL,
	"job_type" text NOT NULL,
	"payload_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"cause" text NOT NULL,
	"last_error" jsonb NOT NULL,
	"attempts" integer NOT NULL,
	"job_created_at" timestamp with time zone NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace_id" text NOT NULL,
	"generic_retry_allowed" boolean NOT NULL,
	"final_failure_notified" boolean DEFAULT false NOT NULL,
	"final_failure_attempts" integer DEFAULT 0 NOT NULL,
	"retry_status" text DEFAULT 'none' NOT NULL,
	"retry_requested_by" text,
	"retry_requested_at" timestamp with time zone,
	"retried_at" timestamp with time zone,
	"new_job_id" uuid,
	CONSTRAINT "dead_jobs_original_job_id_key" UNIQUE("original_job_id"),
	CONSTRAINT "dead_jobs_queue_check" CHECK (queue IN ('publish', 'media', 'ai_batch', 'trends', 'notify', 'scheduled')),
	CONSTRAINT "dead_jobs_cause_check" CHECK (cause IN ('RETRIES_EXHAUSTED', 'PERMANENT_ERROR', 'NO_HANDLER', 'PAYLOAD_INVALID', 'EXPIRED')),
	CONSTRAINT "dead_jobs_retry_status_check" CHECK (retry_status IN ('none', 'requested', 'retried', 'rejected_already_active')),
	CONSTRAINT "dead_jobs_last_error_size_check" CHECK (octet_length(last_error::text) <= 2048)
);
--> statement-breakpoint
ALTER TABLE "infra"."dead_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "infra"."dead_jobs" ADD CONSTRAINT "dead_jobs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dead_jobs_account_id_failed_at_idx" ON "infra"."dead_jobs" USING btree ("account_id","failed_at");--> statement-breakpoint
CREATE INDEX "dead_jobs_queue_failed_at_idx" ON "infra"."dead_jobs" USING btree ("queue","failed_at");--> statement-breakpoint
CREATE INDEX "dead_jobs_retry_requested_idx" ON "infra"."dead_jobs" USING btree ("retry_status") WHERE retry_status = 'requested';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "infra"."dead_jobs" AS PERMISSIVE FOR ALL TO "app" USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());--> statement-breakpoint
CREATE POLICY "system_scoped" ON "infra"."dead_jobs" AS PERMISSIVE FOR ALL TO "system" USING (account_id = account.current_account_id() OR (account_id IS NULL AND account.current_account_id() IS NULL)) WITH CHECK (account_id = account.current_account_id() OR (account_id IS NULL AND account.current_account_id() IS NULL));
--> statement-breakpoint
-- ===================== Phần viết tay (003 data-model mục 5, research R8, R14) =====================
-- infra không có quyền mặc định (0000) – cấp tường minh.
GRANT SELECT, INSERT, UPDATE, DELETE ON infra.dead_jobs TO "app", "system";
--> statement-breakpoint
-- Dọn việc hỏng quá hạn giữ (90 ngày) – việc định kỳ queue.cleanup. Trả số dòng đã xóa.
CREATE OR REPLACE FUNCTION infra.cleanup_dead_jobs(older_than_days int) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, infra
AS $$
DECLARE n int;
BEGIN
  IF older_than_days < 1 THEN RAISE EXCEPTION 'older_than_days phải ≥ 1'; END IF;
  DELETE FROM infra.dead_jobs WHERE failed_at < now() - make_interval(days => older_than_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
--> statement-breakpoint
-- Yêu cầu chạy lại đang chờ (việc định kỳ queue.dead_job_retries). Chỉ trả mã – Worker xử lý từng dòng
-- trong ngữ cảnh tài khoản của dòng đó (khóa dòng lại bằng FOR UPDATE trong giao dịch riêng).
CREATE OR REPLACE FUNCTION infra.claim_dead_job_retries(max_rows int)
  RETURNS TABLE (id uuid, account_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, infra
AS $$
  SELECT d.id, d.account_id FROM infra.dead_jobs d
   WHERE d.retry_status = 'requested'
   ORDER BY d.retry_requested_at
   LIMIT least(greatest(max_rows, 1), 100)
$$;
--> statement-breakpoint
-- Việc hỏng có onFinalFailure chưa gọi thành công (tối đa 5 lần) – việc định kỳ queue.sweep_failed.
CREATE OR REPLACE FUNCTION infra.pending_final_failures(max_rows int)
  RETURNS TABLE (id uuid, account_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, infra
AS $$
  SELECT d.id, d.account_id FROM infra.dead_jobs d
   WHERE NOT d.final_failure_notified AND d.final_failure_attempts < 5
   ORDER BY d.failed_at
   LIMIT least(greatest(max_rows, 1), 100)
$$;
--> statement-breakpoint
-- Số việc hỏng mỗi hàng chờ từ một mốc (chỉ số queue.dead_jobs.last_24h) – không lộ dữ liệu việc.
CREATE OR REPLACE FUNCTION infra.count_dead_jobs_since(since timestamptz)
  RETURNS TABLE (queue text, n bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, infra
AS $$
  SELECT d.queue, count(*) FROM infra.dead_jobs d WHERE d.failed_at >= since GROUP BY d.queue
$$;
--> statement-breakpoint
-- Hỗ trợ yêu cầu chạy lại MỘT việc hỏng (R14, Clarifications Q1) – kiểm, đặt trạng thái và ghi kiểm toán
-- trong MỘT lời gọi. Việc của loại không cho chạy lại chung (publish) → từ chối, dùng "Đăng lại".
-- p_audit_id: UUID v7 sinh ở ứng dụng cho dòng kiểm toán.
CREATE OR REPLACE FUNCTION infra.request_dead_job_retry(
  p_id uuid, p_staff text, p_reason text, p_audit_id uuid, p_trace_id text
) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, infra
AS $$
DECLARE
  r infra.dead_jobs%ROWTYPE;
  why text;
BEGIN
  IF p_staff IS NULL OR btrim(p_staff) = '' THEN RAISE EXCEPTION 'Thiếu mã nhân viên'; END IF;
  SELECT * INTO r FROM infra.dead_jobs WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  IF NOT r.generic_retry_allowed THEN
    why := 'not_allowed';
  ELSIF r.retry_status = 'requested' THEN
    why := 'already_requested';
  ELSIF EXISTS (
    SELECT 1 FROM pgboss.job_common j
     WHERE j.name = r.queue AND j.state <= 'active'
       AND (j.id = r.new_job_id OR j.singleton_key = r.dedupe_key)
  ) THEN
    why := 'already_active';
  END IF;

  IF why IS NOT NULL THEN
    INSERT INTO infra.audit_log (id, account_id, actor_type, actor_id, action, reason, trace_id, metadata)
    VALUES (p_audit_id, r.account_id, 'support', p_staff, 'dead_job.retry_rejected', p_reason, p_trace_id,
            jsonb_build_object('dead_job_id', r.id, 'why', why));
    RETURN CASE WHEN why = 'not_allowed' THEN 'rejected_not_allowed' ELSE 'rejected_already_active' END;
  END IF;

  UPDATE infra.dead_jobs
     SET retry_status = 'requested', retry_requested_by = p_staff, retry_requested_at = now()
   WHERE id = r.id;
  INSERT INTO infra.audit_log (id, account_id, actor_type, actor_id, action, reason, trace_id, metadata)
  VALUES (p_audit_id, r.account_id, 'support', p_staff, 'dead_job.retry_requested', p_reason, p_trace_id,
          jsonb_build_object('dead_job_id', r.id));
  RETURN 'requested';
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION infra.cleanup_dead_jobs(int), infra.claim_dead_job_retries(int),
  infra.pending_final_failures(int), infra.count_dead_jobs_since(timestamptz),
  infra.request_dead_job_retry(uuid, text, text, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION infra.cleanup_dead_jobs(int), infra.claim_dead_job_retries(int),
  infra.pending_final_failures(int), infra.count_dead_jobs_since(timestamptz) TO "system";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION infra.request_dead_job_retry(uuid, text, text, uuid, text) TO "support";
--> statement-breakpoint
-- Khung nhìn hỗ trợ (R14). Do "owner" sở hữu → đọc vượt RLS → CHỈ cấp cho support (quy tắc i).
-- Tìm kiếm xuyên tài khoản: không có dữ liệu việc, không có lỗi.
CREATE VIEW infra.support_dead_jobs_search AS
  SELECT id, account_id, queue, job_type, cause, attempts, failed_at, retry_status, retried_at
    FROM infra.dead_jobs;
--> statement-breakpoint
-- Chi tiết MỘT tài khoản: lọc tường minh theo ngữ cảnh tenant (supportViewAccount đặt biến phiên).
CREATE VIEW infra.support_dead_jobs_detail AS
  SELECT id, account_id, original_job_id, queue, job_type, payload_version, payload, dedupe_key, cause,
         last_error, attempts, job_created_at, failed_at, trace_id, generic_retry_allowed, retry_status,
         retry_requested_by, retry_requested_at, retried_at, new_job_id
    FROM infra.dead_jobs
   WHERE account_id = account.current_account_id();
--> statement-breakpoint
GRANT SELECT ON infra.support_dead_jobs_search, infra.support_dead_jobs_detail TO "support";
