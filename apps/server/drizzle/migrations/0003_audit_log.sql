-- Migration tay 0003 (data-model mục 7, FR-024): nhật ký kiểm toán CHỈ-THÊM, phân vùng theo tháng.
-- Định nghĩa Drizzle để chèn có kiểu: src/core/db/audit-log.log-table.ts (ngoài glob drizzle-kit).
CREATE TABLE infra.audit_log (
  id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- NULL cho lần tìm kiếm xuyên tài khoản. KHÔNG khóa ngoại: dòng kiểm toán còn sau khi xóa tài khoản.
  account_id uuid NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('support', 'admin', 'system')),
  actor_id text NOT NULL,
  action text NOT NULL,
  -- Loại từ khóa (email, post_id, …) – KHÔNG lưu giá trị từ khóa.
  keyword_type text NULL,
  reason text NULL,
  trace_id text NULL,
  -- Không chứa bí mật/dữ liệu cá nhân của khách; đặt NULL khi ẩn danh hóa.
  metadata jsonb NULL,
  CONSTRAINT audit_log_view_account_reason CHECK (action <> 'support.view_account' OR reason IS NOT NULL),
  PRIMARY KEY (occurred_at, id)
) PARTITION BY RANGE (occurred_at);
--> statement-breakpoint
CREATE INDEX audit_log_account_id_occurred_at_idx ON infra.audit_log (account_id, occurred_at);
--> statement-breakpoint
-- Chỉ INSERT – không ai ngoài "owner" đọc/sửa/xóa (đọc qua khung nhìn quản trị sau này).
GRANT INSERT ON infra.audit_log TO "app", "system", "support";
--> statement-breakpoint
ALTER TABLE infra.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_insert ON infra.audit_log AS PERMISSIVE FOR INSERT
  TO "app", "system", "support" WITH CHECK (true);
--> statement-breakpoint
-- Tạo phân vùng tháng hiện tại (UTC) → +months_ahead nếu chưa có. Idempotent. Việc định kỳ của
-- Worker (WBS 1.3) gọi bằng vai trò "system"; bỏ phân vùng > 12 tháng cũng ở WBS 1.3.
CREATE OR REPLACE FUNCTION infra.ensure_audit_log_partitions(months_ahead int DEFAULT 1)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, infra
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
    partition_name := format('audit_log_y%sm%s', to_char(month_start, 'YYYY'), to_char(month_start, 'MM'));
    IF to_regclass(format('infra.%I', partition_name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE infra.%I PARTITION OF infra.audit_log FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        month_start::timestamp AT TIME ZONE 'UTC',
        (month_start + interval '1 month')::timestamp AT TIME ZONE 'UTC'
      );
      -- Phân vùng không có chính sách → chặn truy cập thẳng vào phân vùng của mọi vai trò ứng dụng.
      EXECUTE format('ALTER TABLE infra.%I ENABLE ROW LEVEL SECURITY', partition_name);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION infra.ensure_audit_log_partitions(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION infra.ensure_audit_log_partitions(int) TO "system";
--> statement-breakpoint
SELECT infra.ensure_audit_log_partitions(1);
