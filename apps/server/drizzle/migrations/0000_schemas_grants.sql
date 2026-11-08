-- Migration tay 0000 (data-model mục 1–3, research R2, R6). Chạy bằng vai trò "owner".
-- Schema theo modules.manifest.json (11 schema), quyền mặc định, hàm ngữ cảnh tenant.
-- Thêm module mới vào tệp kê khai → thêm migration tạo schema + quyền tương tự (migrate.db.spec.ts
-- so tập schema với tệp kê khai).

-- 1. Schema – chủ "owner".
CREATE SCHEMA IF NOT EXISTS account AUTHORIZATION "owner";
CREATE SCHEMA IF NOT EXISTS context AUTHORIZATION "owner";
CREATE SCHEMA IF NOT EXISTS media AUTHORIZATION "owner";
CREATE SCHEMA IF NOT EXISTS trends AUTHORIZATION "owner";
CREATE SCHEMA IF NOT EXISTS content AUTHORIZATION "owner";
CREATE SCHEMA IF NOT EXISTS approval AUTHORIZATION "owner";
CREATE SCHEMA IF NOT EXISTS publishing AUTHORIZATION "owner";
CREATE SCHEMA IF NOT EXISTS platform_gateway AUTHORIZATION "owner";
CREATE SCHEMA IF NOT EXISTS ai_gateway AUTHORIZATION "owner";
CREATE SCHEMA IF NOT EXISTS notifications AUTHORIZATION "owner";
CREATE SCHEMA IF NOT EXISTS infra AUTHORIZATION "owner";

-- 2. USAGE: mọi schema nghiệp vụ/cổng + infra cho app, system; approval là schema dành sẵn – chưa cấp.
GRANT USAGE ON SCHEMA account, context, media, trends, content, publishing, platform_gateway,
  ai_gateway, notifications, infra TO "app", "system";
GRANT USAGE ON SCHEMA infra TO "support";

-- 3. Quyền mặc định cho bảng/chuỗi tạo sau này bởi "owner" (KHÔNG cho infra, approval – infra cấp
--    tường minh từng đối tượng). Bảng chỉ đọc tự REVOKE trong migration của nó.
ALTER DEFAULT PRIVILEGES FOR ROLE "owner" IN SCHEMA account, context, media, trends, content,
  publishing, platform_gateway, ai_gateway, notifications
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app", "system";
ALTER DEFAULT PRIVILEGES FOR ROLE "owner" IN SCHEMA account, context, media, trends, content,
  publishing, platform_gateway, ai_gateway, notifications
  GRANT USAGE, SELECT ON SEQUENCES TO "app", "system";

-- Hàm mới không tự cấp EXECUTE cho PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE "owner" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 4. Hàm ngữ cảnh tenant (R2) – PHẢI có trước mọi chính sách dùng nó.
-- Sau khi giao dịch đã set_config(..., true) kết thúc, biến thành chuỗi rỗng chứ không về NULL;
-- nullif đưa cả "chưa đặt" và "đã hết giao dịch" về NULL → account_id = NULL không khớp dòng nào.
CREATE OR REPLACE FUNCTION account.current_account_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.account_id', true), '')::uuid $$;
REVOKE ALL ON FUNCTION account.current_account_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account.current_account_id() TO "app", "system", "support";
