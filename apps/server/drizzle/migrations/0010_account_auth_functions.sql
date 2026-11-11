-- Migration tay 0010 (004, data-model.md mục 4, research R4): 4 hàm SECURITY DEFINER hẹp cho các
-- bước xác thực xảy ra TRƯỚC khi biết tenant (đăng ký, tra email, tra phiên, tra mã một lần).
-- Chung: chủ "owner" (chủ bảng – không bị RLS vì không FORCE), search_path cố định, REVOKE PUBLIC,
-- chỉ "app" có EXECUTE (không cấp "system", "support"). Đầu vào đã chuẩn hóa/băm ở ứng dụng; hàm
-- không ghi nhật ký và chỉ trả đúng các cột liệt kê. Mọi thay đổi ở đây phải review theo nguyên tắc I.

-- 1. Đăng ký: tạo tài khoản + người dùng + cách đăng nhập + vai trò chủ + mã xác minh trong MỘT
--    câu gọi (FR-001: nguyên vẹn). Trùng email → hoàn tác khối con, trả 'email_taken'.
CREATE OR REPLACE FUNCTION account.auth_register(
  p_account_id uuid,
  p_user_id uuid,
  p_identity_id uuid,
  p_membership_id uuid,
  p_token_id uuid,
  p_display_name text,
  p_email text,
  p_email_normalized text,
  p_password_hash text,
  p_terms_version text,
  p_token_hash bytea,
  p_token_expires_at timestamptz
) RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
DECLARE
  v_constraint text;
BEGIN
  BEGIN
    INSERT INTO account.accounts (id, status) VALUES (p_account_id, 'active');
    INSERT INTO account.users (id, account_id, display_name, email, email_normalized, status,
                               terms_version, terms_accepted_at)
      VALUES (p_user_id, p_account_id, p_display_name, p_email, p_email_normalized, 'active',
              p_terms_version, now());
    INSERT INTO account.login_identities (id, account_id, user_id, provider, provider_subject,
                                          password_hash)
      VALUES (p_identity_id, p_account_id, p_user_id, 'password', p_user_id::text, p_password_hash);
    INSERT INTO account.memberships (id, account_id, user_id, role, seat, status)
      VALUES (p_membership_id, p_account_id, p_user_id, 'owner', 0, 'active');
    INSERT INTO account.auth_tokens (id, account_id, user_id, purpose, token_hash, email_normalized,
                                     expires_at)
      VALUES (p_token_id, p_account_id, p_user_id, 'verify_email', p_token_hash, p_email_normalized,
              p_token_expires_at);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'users_email_normalized_key' THEN
      RETURN 'email_taken';
    END IF;
    RAISE;
  END;
  RETURN 'created';
END
$$;
--> statement-breakpoint
ALTER FUNCTION account.auth_register(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, bytea, timestamptz) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.auth_register(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, bytea, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.auth_register(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, bytea, timestamptz) TO "app";
--> statement-breakpoint

-- 2. Tra email (đăng nhập, quên mật khẩu, thư "email đã có tài khoản"): chỉ khớp chính xác email đã
--    chuẩn hóa, bỏ qua tài khoản đã xóa. Không wildcard, không tiền tố.
CREATE OR REPLACE FUNCTION account.auth_lookup_email(p_email_normalized text)
  RETURNS TABLE (
    user_id uuid,
    account_id uuid,
    display_name text,
    password_hash text,
    user_status text,
    member_status text,
    account_status text,
    email_verified_at timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
  SELECT u.id, u.account_id, u.display_name, li.password_hash, u.status, m.status, a.status,
         u.email_verified_at
    FROM account.users u
    JOIN account.accounts a ON a.id = u.account_id AND a.deleted_at IS NULL
    LEFT JOIN account.login_identities li
      ON li.account_id = u.account_id AND li.user_id = u.id AND li.provider = 'password'
    LEFT JOIN account.memberships m ON m.account_id = u.account_id AND m.user_id = u.id
   WHERE u.email_normalized = p_email_normalized
   LIMIT 1
$$;
--> statement-breakpoint
ALTER FUNCTION account.auth_lookup_email(text) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.auth_lookup_email(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.auth_lookup_email(text) TO "app";
--> statement-breakpoint

-- 3. Tra phiên theo băm mã: chỉ trả khi phiên còn hiệu lực, người dùng active, membership active,
--    tài khoản không 'deleting'/đã xóa. Cập nhật last_seen_at/idle_expires_at khi đã cũ hơn
--    p_touch_after (không ghi CSDL ở mọi yêu cầu – R3).
CREATE OR REPLACE FUNCTION account.auth_resolve_session(
  p_token_hash bytea,
  p_touch_after interval,
  p_idle interval
) RETURNS TABLE (
    session_id uuid,
    user_id uuid,
    account_id uuid,
    role text,
    email_verified boolean,
    display_name text,
    absolute_expires_at timestamptz
  )
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
#variable_conflict use_column
DECLARE
  r record;
BEGIN
  SELECT s.id AS sid, s.user_id AS uid, s.account_id AS aid, m.role AS mrole,
         (u.email_verified_at IS NOT NULL) AS verified, u.display_name AS dname,
         s.absolute_expires_at AS abs_exp, s.last_seen_at AS seen
    INTO r
    FROM account.sessions s
    JOIN account.users u ON u.account_id = s.account_id AND u.id = s.user_id
    JOIN account.memberships m ON m.account_id = s.account_id AND m.user_id = s.user_id
    JOIN account.accounts a ON a.id = s.account_id
   WHERE s.token_hash = p_token_hash
     AND s.revoked_at IS NULL
     AND now() < s.idle_expires_at
     AND now() < s.absolute_expires_at
     AND u.status = 'active'
     AND m.status = 'active'
     AND a.status <> 'deleting'
     AND a.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF now() - r.seen > p_touch_after THEN
    UPDATE account.sessions
       SET last_seen_at = now(), idle_expires_at = now() + p_idle, updated_at = now()
     WHERE id = r.sid AND revoked_at IS NULL;
  END IF;
  session_id := r.sid;
  user_id := r.uid;
  account_id := r.aid;
  role := r.mrole;
  email_verified := r.verified;
  display_name := r.dname;
  absolute_expires_at := r.abs_exp;
  RETURN NEXT;
END
$$;
--> statement-breakpoint
ALTER FUNCTION account.auth_resolve_session(bytea, interval, interval) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.auth_resolve_session(bytea, interval, interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.auth_resolve_session(bytea, interval, interval) TO "app";
--> statement-breakpoint

-- 4. Tra mã một lần còn hiệu lực (xác minh email, đặt lại mật khẩu). KHÔNG tiêu thụ: việc tiêu thụ
--    là cập nhật có điều kiện trong tenantTx (R8).
CREATE OR REPLACE FUNCTION account.auth_find_token(p_token_hash bytea, p_purpose text)
  RETURNS TABLE (token_id uuid, account_id uuid, user_id uuid, email_normalized text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
  SELECT t.id, t.account_id, t.user_id, t.email_normalized
    FROM account.auth_tokens t
    JOIN account.accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
   WHERE t.token_hash = p_token_hash
     AND t.purpose = p_purpose
     AND t.used_at IS NULL
     AND t.expires_at > now()
   LIMIT 1
$$;
--> statement-breakpoint
ALTER FUNCTION account.auth_find_token(bytea, text) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.auth_find_token(bytea, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.auth_find_token(bytea, text) TO "app";
