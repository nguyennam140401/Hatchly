-- Khởi tạo 4 vai trò CSDL và quyền cấp CSDL (research R6, data-model mục 2). IDEMPOTENT.
-- Chạy bằng tài khoản quản trị cụm, kết nối vào CSDL đích. Dùng chung cho dev (pnpm db:bootstrap)
-- và hạ tầng môi trường thật (WBS 1.5).
--
-- Mật khẩu KHÔNG nằm trong tệp này. Truyền qua biến phiên trước khi chạy:
--   bootstrap.password_owner / _app / _system / _support   (bắt buộc khi tạo mới hoặc đặt lại)
--   bootstrap.keep_existing_passwords = 'on'               (vai trò đã có thì không đổi mật khẩu)
-- Ví dụ psql:  SET bootstrap.password_app = :'pw_app';  …  \i roles.sql
-- Script Node (src/db/bootstrap.ts) đặt bằng set_config($1) có tham số ràng buộc.
-- Mật khẩu được ghép vào câu lệnh ở PHÍA MÁY CHỦ bằng format('%L') – không nối chuỗi ở ứng dụng.

DO $$
DECLARE
  role_name text;
  pw text;
  keep boolean := coalesce(current_setting('bootstrap.keep_existing_passwords', true), '') = 'on';
  membership record;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['owner', 'app', 'system', 'support'] LOOP
    pw := nullif(current_setting('bootstrap.password_' || role_name, true), '');

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      IF pw IS NULL THEN
        RAISE EXCEPTION 'Thiếu mật khẩu cho vai trò mới "%"', role_name;
      END IF;
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', role_name, pw);
    ELSIF NOT keep THEN
      IF pw IS NULL THEN
        RAISE EXCEPTION 'Thiếu mật khẩu cho vai trò "%"', role_name;
      END IF;
      EXECUTE format('ALTER ROLE %I PASSWORD %L', role_name, pw);
    END IF;

    -- Chuẩn hóa thuộc tính mỗi lần chạy: không vai trò nào vượt được RLS hay tạo vai trò/CSDL.
    EXECUTE format(
      'ALTER ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT',
      role_name
    );

    -- Không vai trò nào là thành viên của vai trò khác (US4-AS6: SET ROLE bị từ chối).
    FOR membership IN
      SELECT g.rolname AS granted
      FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles g ON g.oid = m.roleid
      JOIN pg_catalog.pg_roles u ON u.oid = m.member
      WHERE u.rolname = role_name
    LOOP
      EXECUTE format('REVOKE %I FROM %I', membership.granted, role_name);
    END LOOP;
  END LOOP;

  EXECUTE format('ALTER DATABASE %I OWNER TO "owner"', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format(
    'GRANT CONNECT, TEMPORARY ON DATABASE %I TO "owner", "app", "system", "support"',
    current_database()
  );
END
$$;

-- Schema public không dùng: không ai được tạo đối tượng trong đó.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
