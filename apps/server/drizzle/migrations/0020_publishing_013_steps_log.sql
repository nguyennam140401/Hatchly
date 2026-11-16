-- Migration tay 0020 (013, data-model.md mục 3, 4): nhật ký 5 bước `publishing.publish_steps` CHỈ-THÊM, phân vùng
-- theo tháng; quyền của `error_mappings`; dữ liệu khởi tạo ánh xạ lỗi Facebook/Instagram (ADD mục 7).
-- Định nghĩa Drizzle để chèn có kiểu: modules/publishing/internal/db/publish-steps.log-table.ts.
-- Chỉ thêm bảng/hàm/dữ liệu → tương thích ngược (API, Worker cũ không chạm).
CREATE TABLE publishing.publish_steps (
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  -- Tham chiếu publish_attempts; KHÔNG khóa ngoại (bảng phân vùng, nhật ký sống lâu hơn dữ liệu nghiệp vụ).
  attempt_id uuid NOT NULL,
  run_no integer NOT NULL,
  step_no smallint NOT NULL CHECK (step_no BETWEEN 1 AND 5),
  step_key text NOT NULL CHECK (step_key IN ('precheck', 'prepare_media', 'submit', 'await_processing', 'confirm')),
  event text NOT NULL CHECK (event IN ('started', 'finished')),
  outcome text NULL CHECK (outcome IS NULL OR outcome IN ('succeeded', 'failed', 'skipped', 'not_applicable')),
  error_category text NULL CHECK (error_category IS NULL OR error_category IN ('transient', 'user_action', 'unknown')),
  raw_code text NULL CHECK (raw_code IS NULL OR raw_code ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  message_vi text NULL CHECK (message_vi IS NULL OR char_length(message_vi) <= 500),
  remedies jsonb NULL,
  note text NULL CHECK (note IS NULL OR char_length(note) <= 200),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  trace_id text NOT NULL,
  CONSTRAINT publish_steps_outcome_when_finished CHECK ((event = 'finished') = (outcome IS NOT NULL)),
  CONSTRAINT publish_steps_failed_has_remedy CHECK (outcome IS DISTINCT FROM 'failed' OR (remedies IS NOT NULL AND jsonb_array_length(remedies) >= 1)),
  PRIMARY KEY (occurred_at, id)
) PARTITION BY RANGE (occurred_at);
--> statement-breakpoint
CREATE INDEX publish_steps_attempt_idx ON publishing.publish_steps (account_id, attempt_id, run_no, step_no, occurred_at);
--> statement-breakpoint
-- Chỉ INSERT + SELECT: nhật ký bất biến (không UPDATE/DELETE); xóa bằng bỏ cả phân vùng > 12 tháng.
-- Quyền mặc định của schema (0000) cấp cả UPDATE, DELETE cho bảng mới → thu hồi tường minh.
REVOKE UPDATE, DELETE, TRUNCATE ON publishing.publish_steps FROM "app", "system";
--> statement-breakpoint
GRANT SELECT, INSERT ON publishing.publish_steps TO "app", "system";
--> statement-breakpoint
ALTER TABLE publishing.publish_steps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON publishing.publish_steps AS PERMISSIVE FOR ALL TO "app", "system"
  USING (account_id = account.current_account_id()) WITH CHECK (account_id = account.current_account_id());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION publishing.ensure_publish_steps_partitions(months_ahead int DEFAULT 1)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, publishing
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
    partition_name := format('publish_steps_y%sm%s', to_char(month_start, 'YYYY'), to_char(month_start, 'MM'));
    IF to_regclass(format('publishing.%I', partition_name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE publishing.%I PARTITION OF publishing.publish_steps FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        month_start::timestamp AT TIME ZONE 'UTC',
        (month_start + interval '1 month')::timestamp AT TIME ZONE 'UTC'
      );
      -- Phân vùng không có chính sách → chặn truy cập thẳng vào phân vùng của mọi vai trò ứng dụng.
      EXECUTE format('ALTER TABLE publishing.%I ENABLE ROW LEVEL SECURITY', partition_name);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION publishing.ensure_publish_steps_partitions(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION publishing.ensure_publish_steps_partitions(int) TO "system";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION publishing.drop_publish_steps_partitions_before(months int) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, publishing
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
     WHERE n2.nspname = 'publishing' AND p.relname = 'publish_steps'
  LOOP
    upper_bound := substring(part.bound FROM 'TO \(''([^'']+)''\)')::timestamptz;
    IF upper_bound IS NOT NULL AND upper_bound <= cutoff THEN
      EXECUTE format('DROP TABLE publishing.%I', part.name);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION publishing.drop_publish_steps_partitions_before(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION publishing.drop_publish_steps_partitions_before(int) TO "system";
--> statement-breakpoint
SELECT publishing.ensure_publish_steps_partitions(2);
--> statement-breakpoint
-- `error_mappings` là cấu hình dùng chung: ứng dụng (`app`) chỉ ĐỌC; `system` (quản trị nội bộ) được ghi và
-- mọi thay đổi phải ghi `audit_log` `error_mapping.updated` (research R11).
REVOKE INSERT, UPDATE, DELETE ON publishing.error_mappings FROM "app";
--> statement-breakpoint
-- Dữ liệu khởi tạo (ADD mục 7). Mã gốc dạng <NỀN TẢNG>:<mã>. QUY TẮC AN TOÀN: `transient` CHỈ cho mã chắc chắn
-- nền tảng chưa nhận bài (lỗi mạng trước khi gửi, giới hạn tốc độ, quá tải có mã rõ ràng); mã khác/lạ → unknown.
INSERT INTO publishing.error_mappings
  (id, channel_type, raw_code, category, message_vi, remedies, needs_reason, retry_after_sec)
VALUES
  -- Facebook Page
  ('0194f000-0000-7000-8000-000000000001', 'facebook_page', 'FB:190', 'user_action',
   'Quyền đăng bài lên Trang đã hết hạn hoặc bị thu hồi. Hãy kết nối lại Trang để tiếp tục đăng.',
   '[{"action":"reconnect","labelVi":"Kết nối lại Trang"}]', 'token_expired', NULL),
  ('0194f000-0000-7000-8000-000000000002', 'facebook_page', 'FB:102', 'user_action',
   'Phiên kết nối với Facebook đã hết hạn. Hãy kết nối lại Trang để tiếp tục đăng.',
   '[{"action":"reconnect","labelVi":"Kết nối lại Trang"}]', 'token_expired', NULL),
  ('0194f000-0000-7000-8000-000000000003', 'facebook_page', 'FB:200', 'user_action',
   'Ứng dụng chưa có đủ quyền đăng lên Trang. Hãy kết nối lại và cấp đủ quyền được yêu cầu.',
   '[{"action":"reconnect","labelVi":"Kết nối lại và cấp quyền"}]', 'token_expired', NULL),
  ('0194f000-0000-7000-8000-000000000004', 'facebook_page', 'FB:100', 'user_action',
   'Facebook không nhận ảnh hoặc video của bài này. Hãy chọn ảnh/video khác (JPEG hoặc PNG, MP4) rồi đăng lại.',
   '[{"action":"edit_media","labelVi":"Chọn ảnh/video khác"}]', 'media_invalid', NULL),
  ('0194f000-0000-7000-8000-000000000005', 'facebook_page', 'FB:368', 'user_action',
   'Facebook tạm chặn bài này vì nghi vi phạm chính sách. Hãy kiểm tra Trang trên Facebook hoặc liên hệ hỗ trợ.',
   '[{"action":"check_on_platform","labelVi":"Kiểm tra Trang trên Facebook"},{"action":"contact_support","labelVi":"Liên hệ hỗ trợ"}]', 'other', NULL),
  ('0194f000-0000-7000-8000-000000000006', 'facebook_page', 'FB:4', 'transient',
   'Facebook đang giới hạn tốc độ đăng. Hệ thống sẽ tự thử lại sau ít phút.',
   '[{"action":"retry_later","labelVi":"Chờ hệ thống tự thử lại"}]', NULL, 600),
  ('0194f000-0000-7000-8000-000000000007', 'facebook_page', 'FB:17', 'transient',
   'Facebook đang giới hạn tốc độ đăng. Hệ thống sẽ tự thử lại sau ít phút.',
   '[{"action":"retry_later","labelVi":"Chờ hệ thống tự thử lại"}]', NULL, 600),
  ('0194f000-0000-7000-8000-000000000008', 'facebook_page', 'FB:32', 'transient',
   'Facebook đang giới hạn tốc độ đăng. Hệ thống sẽ tự thử lại sau ít phút.',
   '[{"action":"retry_later","labelVi":"Chờ hệ thống tự thử lại"}]', NULL, 600),
  ('0194f000-0000-7000-8000-000000000009', 'facebook_page', 'FB:2', 'transient',
   'Facebook tạm quá tải và chưa nhận bài. Hệ thống sẽ tự thử lại sau ít phút.',
   '[{"action":"retry_later","labelVi":"Chờ hệ thống tự thử lại"}]', NULL, 60),
  ('0194f000-0000-7000-8000-00000000000a', 'facebook_page', 'FB:NET_BEFORE_SEND', 'transient',
   'Chưa kết nối được tới Facebook nên bài chưa được gửi. Hệ thống sẽ tự thử lại sau ít phút.',
   '[{"action":"retry_later","labelVi":"Chờ hệ thống tự thử lại"}]', NULL, 60),
  -- Instagram
  ('0194f000-0000-7000-8000-000000000101', 'instagram', 'IG:190', 'user_action',
   'Quyền đăng bài lên Instagram đã hết hạn hoặc bị thu hồi. Hãy kết nối lại tài khoản Instagram.',
   '[{"action":"reconnect","labelVi":"Kết nối lại Instagram"}]', 'token_expired', NULL),
  ('0194f000-0000-7000-8000-000000000102', 'instagram', 'IG:10', 'user_action',
   'Ứng dụng chưa có đủ quyền đăng lên Instagram. Hãy kết nối lại và cấp đủ quyền được yêu cầu.',
   '[{"action":"reconnect","labelVi":"Kết nối lại và cấp quyền"}]', 'token_expired', NULL),
  ('0194f000-0000-7000-8000-000000000103', 'instagram', 'IG:NOT_PROFESSIONAL', 'user_action',
   'Tài khoản Instagram chưa là tài khoản chuyên nghiệp (Business/Creator) nên chưa đăng bài được. Hãy chuyển sang tài khoản chuyên nghiệp rồi kết nối lại.',
   '[{"action":"reconnect","labelVi":"Kết nối lại sau khi chuyển tài khoản"}]', 'not_professional_account', NULL),
  ('0194f000-0000-7000-8000-000000000104', 'instagram', 'IG:2207026', 'user_action',
   'Instagram không nhận định dạng video này. Hãy chọn video MP4 khác rồi đăng lại.',
   '[{"action":"edit_media","labelVi":"Chọn video khác"}]', 'media_invalid', NULL),
  ('0194f000-0000-7000-8000-000000000105', 'instagram', 'IG:2207004', 'user_action',
   'Ảnh quá lớn so với giới hạn của Instagram. Hãy chọn ảnh nhỏ hơn rồi đăng lại.',
   '[{"action":"edit_media","labelVi":"Chọn ảnh khác"}]', 'media_invalid', NULL),
  ('0194f000-0000-7000-8000-000000000106', 'instagram', 'IG:2207009', 'user_action',
   'Tỉ lệ khung hình của ảnh/video không được Instagram chấp nhận. Hãy chọn ảnh/video khác.',
   '[{"action":"edit_media","labelVi":"Chọn ảnh/video khác"}]', 'media_invalid', NULL),
  ('0194f000-0000-7000-8000-000000000107', 'instagram', 'IG:2207042', 'user_action',
   'Tài khoản Instagram đã hết lượt đăng trong 24 giờ. Hãy chọn giờ đăng khác rồi đăng lại.',
   '[{"action":"retry_later","labelVi":"Chọn giờ đăng khác"}]', 'rate_limited_daily', NULL),
  ('0194f000-0000-7000-8000-000000000108', 'instagram', 'IG:4', 'transient',
   'Instagram đang giới hạn tốc độ đăng. Hệ thống sẽ tự thử lại sau ít phút.',
   '[{"action":"retry_later","labelVi":"Chờ hệ thống tự thử lại"}]', NULL, 600),
  ('0194f000-0000-7000-8000-000000000109', 'instagram', 'IG:17', 'transient',
   'Instagram đang giới hạn tốc độ đăng. Hệ thống sẽ tự thử lại sau ít phút.',
   '[{"action":"retry_later","labelVi":"Chờ hệ thống tự thử lại"}]', NULL, 600),
  ('0194f000-0000-7000-8000-00000000010a', 'instagram', 'IG:2', 'transient',
   'Instagram tạm quá tải và chưa nhận bài. Hệ thống sẽ tự thử lại sau ít phút.',
   '[{"action":"retry_later","labelVi":"Chờ hệ thống tự thử lại"}]', NULL, 60),
  ('0194f000-0000-7000-8000-00000000010b', 'instagram', 'IG:NET_BEFORE_SEND', 'transient',
   'Chưa kết nối được tới Instagram nên bài chưa được gửi. Hệ thống sẽ tự thử lại sau ít phút.',
   '[{"action":"retry_later","labelVi":"Chờ hệ thống tự thử lại"}]', NULL, 60)
ON CONFLICT (channel_type, raw_code) DO NOTHING;
--> statement-breakpoint
-- Hàng chờ `publish` (013): mỗi `retryAfter` (thử lại lỗi tạm thời ≤ 5, kiểm tra xử lý bất đồng bộ, đối soát) tính một
-- lượt thử → nâng trần từ 5 lên 20 (trần của CSDL). Việc hết lượt bị chôn và đi qua `onFinalFailure` (không gửi lại).
UPDATE infra.queue_settings SET max_retries = 20, updated_by = 'migration-013' WHERE queue = 'publish' AND max_retries < 20;
