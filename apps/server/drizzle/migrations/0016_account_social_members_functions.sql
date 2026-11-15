-- Migration tay 0016 (009, data-model.md mục 4, research R6, R9, R10, R18, R20): 8 hàm SECURITY DEFINER
-- cho "app" và 3 cho "system". Chung như 0010: chủ "owner" (chủ bảng – không bị RLS vì không FORCE),
-- search_path cố định, REVOKE PUBLIC, EXECUTE cho ĐÚNG MỘT vai trò. Đầu vào đã chuẩn hóa/băm ở ứng dụng;
-- mã (UUID v7) do ứng dụng sinh; hàm không ghi nhật ký và chỉ trả đúng các cột liệt kê.
-- Mọi thay đổi ở đây phải review theo nguyên tắc I. Hàm auth_resolve_session (0010) được GIỮ cho bản
-- API cũ chạy song song khi phát hành (R20).

-- 1. Tra phiên (bản 2): như auth_resolve_session + cột `detached` (tài khoản của phiên là tài khoản chờ).
CREATE OR REPLACE FUNCTION account.auth_resolve_session_v2(
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
    absolute_expires_at timestamptz,
    detached boolean
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
         s.absolute_expires_at AS abs_exp, s.last_seen_at AS seen,
         (a.status = 'unclaimed') AS is_detached
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
  detached := r.is_detached;
  RETURN NEXT;
END
$$;
--> statement-breakpoint
ALTER FUNCTION account.auth_resolve_session_v2(bytea, interval, interval) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.auth_resolve_session_v2(bytea, interval, interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.auth_resolve_session_v2(bytea, interval, interval) TO "app";
--> statement-breakpoint

-- 2. Tra danh tính nhà cung cấp: khớp chính xác (provider, provider_subject), chỉ google/facebook, bỏ
--    qua tài khoản đã xóa.
CREATE OR REPLACE FUNCTION account.auth_lookup_identity(p_provider text, p_provider_subject text)
  RETURNS TABLE (
    user_id uuid,
    account_id uuid,
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
  SELECT u.id, u.account_id, u.status, m.status, a.status, u.email_verified_at
    FROM account.login_identities li
    JOIN account.users u ON u.account_id = li.account_id AND u.id = li.user_id
    JOIN account.accounts a ON a.id = u.account_id AND a.deleted_at IS NULL
    LEFT JOIN account.memberships m ON m.account_id = u.account_id AND m.user_id = u.id
   WHERE li.provider = p_provider
     AND li.provider_subject = p_provider_subject
     AND p_provider IN ('google', 'facebook')
   LIMIT 1
$$;
--> statement-breakpoint
ALTER FUNCTION account.auth_lookup_identity(text, text) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.auth_lookup_identity(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.auth_lookup_identity(text, text) TO "app";
--> statement-breakpoint

-- 3. Đăng ký qua nhà cung cấp: tài khoản(active) + người dùng + danh tính + vai trò chủ trong MỘT khối.
--    Trùng email → 'email_taken'; danh tính đã gắn người khác → 'identity_taken' (hoàn tác khối con).
CREATE OR REPLACE FUNCTION account.auth_register_oauth(
  p_account_id uuid,
  p_user_id uuid,
  p_identity_id uuid,
  p_membership_id uuid,
  p_display_name text,
  p_email text,
  p_email_normalized text,
  p_email_verified boolean,
  p_provider text,
  p_provider_subject text,
  p_provider_email text,
  p_provider_display_name text,
  p_terms_version text
) RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
DECLARE
  v_constraint text;
BEGIN
  IF p_provider IS NULL OR p_provider NOT IN ('google', 'facebook') THEN
    RAISE EXCEPTION 'auth_register_oauth: nhà cung cấp không hợp lệ' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO account.accounts (id, status) VALUES (p_account_id, 'active');
    INSERT INTO account.users (id, account_id, display_name, email, email_normalized,
                               email_verified_at, status, terms_version, terms_accepted_at)
      VALUES (p_user_id, p_account_id, p_display_name, p_email, p_email_normalized,
              CASE WHEN p_email_verified THEN now() END, 'active', p_terms_version, now());
    INSERT INTO account.login_identities (id, account_id, user_id, provider, provider_subject,
                                          provider_email, provider_display_name, last_used_at)
      VALUES (p_identity_id, p_account_id, p_user_id, p_provider, p_provider_subject,
              p_provider_email, p_provider_display_name, now());
    INSERT INTO account.memberships (id, account_id, user_id, role, seat, status)
      VALUES (p_membership_id, p_account_id, p_user_id, 'owner', 0, 'active');
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'users_email_normalized_key' THEN
      RETURN 'email_taken';
    ELSIF v_constraint = 'login_identities_provider_subject_key' THEN
      RETURN 'identity_taken';
    END IF;
    RAISE;
  END;
  RETURN 'created';
END
$$;
--> statement-breakpoint
ALTER FUNCTION account.auth_register_oauth(uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, text, text, text) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.auth_register_oauth(uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.auth_register_oauth(uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, text, text, text) TO "app";
--> statement-breakpoint

-- 4. Tra lời mời theo băm mã: chỉ khi 'pending', chưa quá hạn, tài khoản mời không 'deleting'/đã xóa.
--    existing_user_state cho email được mời: 'none' | 'detached' (đang ở tài khoản chờ) | 'member'.
CREATE OR REPLACE FUNCTION account.auth_find_invitation(p_token_hash bytea)
  RETURNS TABLE (
    invitation_id uuid,
    account_id uuid,
    email text,
    email_normalized text,
    account_label text,
    inviter_display_name text,
    expires_at timestamptz,
    existing_user_state text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
  SELECT i.id, i.account_id, i.email, i.email_normalized, i.account_label, inviter.display_name,
         i.expires_at,
         COALESCE((
           SELECT CASE WHEN ea.status = 'unclaimed' THEN 'detached' ELSE 'member' END
             FROM account.users eu
             JOIN account.accounts ea ON ea.id = eu.account_id
            WHERE eu.email_normalized = i.email_normalized
            LIMIT 1
         ), 'none')
    FROM account.invitations i
    JOIN account.accounts a ON a.id = i.account_id AND a.deleted_at IS NULL
                           AND a.status NOT IN ('deleting', 'unclaimed')
    LEFT JOIN account.users inviter
      ON inviter.account_id = i.account_id AND inviter.id = i.invited_by_user_id
   WHERE i.token_hash = p_token_hash
     AND i.status = 'pending'
     AND i.expires_at > now()
   LIMIT 1
$$;
--> statement-breakpoint
ALTER FUNCTION account.auth_find_invitation(bytea) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.auth_find_invitation(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.auth_find_invitation(bytea) TO "app";
--> statement-breakpoint

-- 5. Lời mời đang chờ của một email (FR-027). Ứng dụng CHỈ gọi với email đã xác minh của phiên.
CREATE OR REPLACE FUNCTION account.auth_pending_invitations_for_email(p_email_normalized text)
  RETURNS TABLE (
    invitation_id uuid,
    account_label text,
    inviter_display_name text,
    expires_at timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
  SELECT i.id, i.account_label, inviter.display_name, i.expires_at
    FROM account.invitations i
    JOIN account.accounts a ON a.id = i.account_id AND a.deleted_at IS NULL
                           AND a.status NOT IN ('deleting', 'unclaimed')
    LEFT JOIN account.users inviter
      ON inviter.account_id = i.account_id AND inviter.id = i.invited_by_user_id
   WHERE i.email_normalized = p_email_normalized
     AND i.status = 'pending'
     AND i.expires_at > now()
   ORDER BY i.last_sent_at DESC
   LIMIT 20
$$;
--> statement-breakpoint
ALTER FUNCTION account.auth_pending_invitations_for_email(text) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.auth_pending_invitations_for_email(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.auth_pending_invitations_for_email(text) TO "app";
--> statement-breakpoint

-- 5b. Tài khoản của một lời mời theo MÃ lời mời (bổ sung khi thi công): ứng dụng cần biết tenant để mở
--     giao dịch (kiểm toán + việc gửi thư cùng giao dịch với việc chấp nhận) khi người ở tài khoản chờ
--     chấp nhận theo mã lời mời, và ở đường quay về của nhà cung cấp. Chỉ trả mã tài khoản – việc người
--     gọi có được tham gia hay không vẫn do auth_accept_invitation_* quyết định. Cùng điều kiện với mục 4.
CREATE OR REPLACE FUNCTION account.auth_invitation_account(p_invitation_id uuid)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
  SELECT i.account_id
    FROM account.invitations i
    JOIN account.accounts a ON a.id = i.account_id AND a.deleted_at IS NULL
                           AND a.status NOT IN ('deleting', 'unclaimed')
   WHERE i.id = p_invitation_id
     AND i.status = 'pending'
     AND i.expires_at > now()
$$;
--> statement-breakpoint
ALTER FUNCTION account.auth_invitation_account(uuid) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.auth_invitation_account(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.auth_invitation_account(uuid) TO "app";
--> statement-breakpoint

-- 6. Chấp nhận lời mời – người MỚI (mật khẩu HOẶC danh tính nhà cung cấp, đúng một trong hai).
--    Khóa ghế theo tài khoản (R9) → kiểm lời mời → tạo người dùng (email của lời mời, đã xác minh) + một
--    danh tính + vai trò cộng tác viên ở ĐÚNG ghế của lời mời → lời mời 'accepted'.
CREATE OR REPLACE FUNCTION account.auth_accept_invitation_new(
  p_invitation_id uuid,
  p_token_hash bytea,
  p_user_id uuid,
  p_identity_id uuid,
  p_membership_id uuid,
  p_display_name text,
  p_password_hash text,
  p_provider text,
  p_provider_subject text,
  p_provider_email text,
  p_provider_display_name text,
  p_terms_version text
) RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
DECLARE
  v_account_id uuid;
  v_inv record;
  v_constraint text;
BEGIN
  IF (p_password_hash IS NULL) = (p_provider IS NULL) THEN
    RAISE EXCEPTION 'auth_accept_invitation_new: cần đúng một cách đăng nhập' USING ERRCODE = '22023';
  END IF;
  IF p_provider IS NOT NULL AND (p_provider NOT IN ('google', 'facebook') OR p_provider_subject IS NULL) THEN
    RAISE EXCEPTION 'auth_accept_invitation_new: nhà cung cấp không hợp lệ' USING ERRCODE = '22023';
  END IF;

  SELECT i.account_id INTO v_account_id FROM account.invitations i WHERE i.id = p_invitation_id;
  IF NOT FOUND THEN
    RETURN 'invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account.seats:' || v_account_id::text, 0));

  SELECT i.id, i.account_id, i.email, i.email_normalized, i.seat, i.invited_by_user_id
    INTO v_inv
    FROM account.invitations i
    JOIN account.accounts a ON a.id = i.account_id AND a.deleted_at IS NULL
                           AND a.status NOT IN ('deleting', 'unclaimed')
   WHERE i.id = p_invitation_id
     AND i.token_hash = p_token_hash
     AND i.status = 'pending'
     AND i.expires_at > now()
     FOR UPDATE OF i;
  IF NOT FOUND THEN
    RETURN 'invalid';
  END IF;

  IF EXISTS (SELECT 1 FROM account.users u WHERE u.email_normalized = v_inv.email_normalized) THEN
    RETURN 'email_in_use';
  END IF;
  IF p_provider IS NOT NULL AND EXISTS (
       SELECT 1 FROM account.login_identities li
        WHERE li.provider = p_provider AND li.provider_subject = p_provider_subject) THEN
    RETURN 'identity_taken';
  END IF;
  IF EXISTS (SELECT 1 FROM account.memberships m
              WHERE m.account_id = v_inv.account_id AND m.seat = v_inv.seat AND m.status = 'active') THEN
    RETURN 'seat_taken';
  END IF;

  BEGIN
    INSERT INTO account.users (id, account_id, display_name, email, email_normalized,
                               email_verified_at, status, terms_version, terms_accepted_at)
      VALUES (p_user_id, v_inv.account_id, p_display_name, v_inv.email, v_inv.email_normalized,
              now(), 'active', p_terms_version, now());
    IF p_password_hash IS NOT NULL THEN
      INSERT INTO account.login_identities (id, account_id, user_id, provider, provider_subject,
                                            password_hash)
        VALUES (p_identity_id, v_inv.account_id, p_user_id, 'password', p_user_id::text,
                p_password_hash);
    ELSE
      INSERT INTO account.login_identities (id, account_id, user_id, provider, provider_subject,
                                            provider_email, provider_display_name, last_used_at)
        VALUES (p_identity_id, v_inv.account_id, p_user_id, p_provider, p_provider_subject,
                p_provider_email, p_provider_display_name, now());
    END IF;
    INSERT INTO account.memberships (id, account_id, user_id, role, seat, status, added_by_user_id)
      VALUES (p_membership_id, v_inv.account_id, p_user_id, 'collaborator', v_inv.seat, 'active',
              v_inv.invited_by_user_id);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'users_email_normalized_key' THEN
      RETURN 'email_in_use';
    ELSIF v_constraint = 'login_identities_provider_subject_key' THEN
      RETURN 'identity_taken';
    ELSIF v_constraint = 'memberships_account_seat_active_key' THEN
      RETURN 'seat_taken';
    END IF;
    RAISE;
  END;

  UPDATE account.invitations
     SET status = 'accepted', accepted_user_id = p_user_id, closed_at = now(), updated_at = now()
   WHERE id = v_inv.id AND status = 'pending';
  RETURN 'accepted';
END
$$;
--> statement-breakpoint
ALTER FUNCTION account.auth_accept_invitation_new(uuid, bytea, uuid, uuid, uuid, text, text, text, text, text, text, text) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.auth_accept_invitation_new(uuid, bytea, uuid, uuid, uuid, text, text, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.auth_accept_invitation_new(uuid, bytea, uuid, uuid, uuid, text, text, text, text, text, text, text) TO "app";
--> statement-breakpoint

-- 7. Chấp nhận lời mời – người ĐÃ CÓ đang ở tài khoản chờ: CHUYỂN người dùng + cách đăng nhập sang tài
--    khoản mời (mã người dùng không đổi), xóa phiên và mã một lần, kích hoạt lại dòng vai trò 'removed'
--    (hoặc chuyển dòng vai trò của tài khoản chờ sang), xóa former_members, xóa tài khoản chờ.
CREATE OR REPLACE FUNCTION account.auth_accept_invitation_existing(
  p_invitation_id uuid,
  p_user_id uuid
) RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
DECLARE
  v_account_id uuid;
  v_inv record;
  v_user record;
  v_shell_id uuid;
BEGIN
  SELECT i.account_id INTO v_account_id FROM account.invitations i WHERE i.id = p_invitation_id;
  IF NOT FOUND THEN
    RETURN 'invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account.seats:' || v_account_id::text, 0));

  SELECT i.id, i.account_id, i.email_normalized, i.seat, i.invited_by_user_id
    INTO v_inv
    FROM account.invitations i
    JOIN account.accounts a ON a.id = i.account_id AND a.deleted_at IS NULL
                           AND a.status NOT IN ('deleting', 'unclaimed')
   WHERE i.id = p_invitation_id
     AND i.status = 'pending'
     AND i.expires_at > now()
     FOR UPDATE OF i;
  IF NOT FOUND THEN
    RETURN 'invalid';
  END IF;

  SELECT u.id, u.account_id, u.status, u.email_normalized, u.email_verified_at,
         a.status AS account_status
    INTO v_user
    FROM account.users u
    JOIN account.accounts a ON a.id = u.account_id
   WHERE u.id = p_user_id
     FOR UPDATE OF u, a;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.account_status <> 'unclaimed' THEN
    RETURN 'not_eligible';
  END IF;
  IF v_user.email_verified_at IS NULL OR v_user.email_normalized <> v_inv.email_normalized THEN
    RETURN 'email_mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM account.memberships m
              WHERE m.account_id = v_inv.account_id AND m.seat = v_inv.seat AND m.status = 'active') THEN
    RETURN 'seat_taken';
  END IF;

  v_shell_id := v_user.account_id;
  DELETE FROM account.sessions WHERE account_id = v_shell_id AND user_id = p_user_id;
  DELETE FROM account.auth_tokens WHERE account_id = v_shell_id AND user_id = p_user_id;
  UPDATE account.login_identities
     SET account_id = v_inv.account_id, updated_at = now()
   WHERE account_id = v_shell_id AND user_id = p_user_id;
  UPDATE account.users
     SET account_id = v_inv.account_id, detached_at = NULL, deletion_notice_sent_at = NULL,
         updated_at = now()
   WHERE id = p_user_id;

  UPDATE account.memberships
     SET status = 'active', role = 'collaborator', seat = v_inv.seat,
         added_by_user_id = v_inv.invited_by_user_id, updated_at = now()
   WHERE account_id = v_inv.account_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    -- Chưa từng thuộc tài khoản này: chuyển dòng vai trò của tài khoản chờ sang (giữ mã do ứng dụng sinh).
    UPDATE account.memberships
       SET account_id = v_inv.account_id, role = 'collaborator', seat = v_inv.seat, status = 'active',
           added_by_user_id = v_inv.invited_by_user_id, updated_at = now()
     WHERE account_id = v_shell_id AND user_id = p_user_id;
  END IF;

  DELETE FROM account.former_members WHERE account_id = v_inv.account_id AND user_id = p_user_id;
  UPDATE account.invitations
     SET status = 'accepted', accepted_user_id = p_user_id, closed_at = now(), updated_at = now()
   WHERE id = v_inv.id AND status = 'pending';
  DELETE FROM account.accounts WHERE id = v_shell_id AND status = 'unclaimed';
  RETURN 'accepted';
END
$$;
--> statement-breakpoint
ALTER FUNCTION account.auth_accept_invitation_existing(uuid, uuid) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.auth_accept_invitation_existing(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.auth_accept_invitation_existing(uuid, uuid) TO "app";
--> statement-breakpoint

-- 8. Gỡ cộng tác viên: tài khoản lấy từ account.current_account_id() (KHÔNG nhận tham số – nguyên tắc I).
--    Vai trò 'active'/'disabled' → 'removed'; ghi former_members; tạo tài khoản chờ; chuyển người dùng +
--    cách đăng nhập sang đó với ghế chủ; xóa phiên và mã một lần.
CREATE OR REPLACE FUNCTION account.member_detach(
  p_user_id uuid,
  p_shell_account_id uuid,
  p_shell_membership_id uuid,
  p_former_id uuid,
  p_removed_by_user_id uuid
) RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
DECLARE
  v_account_id uuid := account.current_account_id();
  v_member record;
  v_name text;
BEGIN
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'member_detach: thiếu ngữ cảnh tài khoản' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account.seats:' || v_account_id::text, 0));

  SELECT m.id, m.role, m.status INTO v_member
    FROM account.memberships m
   WHERE m.account_id = v_account_id AND m.user_id = p_user_id
     FOR UPDATE;
  IF NOT FOUND OR v_member.status = 'removed' THEN
    RETURN 'not_found';
  END IF;
  IF v_member.role = 'owner' THEN
    RETURN 'owner';
  END IF;
  SELECT u.display_name INTO v_name
    FROM account.users u
   WHERE u.account_id = v_account_id AND u.id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  UPDATE account.memberships SET status = 'removed', updated_at = now() WHERE id = v_member.id;
  INSERT INTO account.former_members (id, account_id, user_id, display_name, removed_at,
                                      removed_by_user_id)
    VALUES (p_former_id, v_account_id, p_user_id, v_name, now(), p_removed_by_user_id)
    ON CONFLICT ON CONSTRAINT former_members_account_user_key DO UPDATE
      SET display_name = EXCLUDED.display_name, removed_at = EXCLUDED.removed_at,
          removed_by_user_id = EXCLUDED.removed_by_user_id, updated_at = now();

  INSERT INTO account.accounts (id, status) VALUES (p_shell_account_id, 'unclaimed');
  DELETE FROM account.sessions WHERE account_id = v_account_id AND user_id = p_user_id;
  DELETE FROM account.auth_tokens WHERE account_id = v_account_id AND user_id = p_user_id;
  UPDATE account.login_identities
     SET account_id = p_shell_account_id, updated_at = now()
   WHERE account_id = v_account_id AND user_id = p_user_id;
  UPDATE account.users
     SET account_id = p_shell_account_id, detached_at = now(), deletion_notice_sent_at = NULL,
         updated_at = now()
   WHERE id = p_user_id;
  INSERT INTO account.memberships (id, account_id, user_id, role, seat, status)
    VALUES (p_shell_membership_id, p_shell_account_id, p_user_id, 'owner', 0, 'active');
  RETURN 'detached';
END
$$;
--> statement-breakpoint
ALTER FUNCTION account.member_detach(uuid, uuid, uuid, uuid, uuid) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.member_detach(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.member_detach(uuid, uuid, uuid, uuid, uuid) TO "app";
--> statement-breakpoint

-- ===== Cấp cho "system" (chỉ Worker) =====

-- 9. Người ở tài khoản chờ đến hạn báo trước ('notice') hoặc xóa ('purge') – research R18.
CREATE OR REPLACE FUNCTION account.detached_users_due(
  p_kind text,
  p_limit int,
  p_retention_days int,
  p_notice_days int
) RETURNS TABLE (account_id uuid, user_id uuid)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
BEGIN
  IF p_kind NOT IN ('notice', 'purge') OR p_retention_days <= p_notice_days OR p_notice_days < 1 THEN
    RAISE EXCEPTION 'detached_users_due: tham số không hợp lệ' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT u.account_id, u.id
      FROM account.users u
      JOIN account.accounts a ON a.id = u.account_id AND a.status = 'unclaimed'
     WHERE u.detached_at IS NOT NULL
       AND CASE p_kind
             WHEN 'notice' THEN
               u.deletion_notice_sent_at IS NULL
               AND u.detached_at <= now() - make_interval(days => p_retention_days - p_notice_days)
             ELSE
               u.detached_at <= now() - make_interval(days => p_retention_days)
               AND u.deletion_notice_sent_at <= now() - make_interval(days => p_notice_days)
           END
     ORDER BY u.detached_at
     LIMIT GREATEST(p_limit, 0);
END
$$;
--> statement-breakpoint
ALTER FUNCTION account.detached_users_due(text, int, int, int) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.detached_users_due(text, int, int, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.detached_users_due(text, int, int, int) TO "system";
--> statement-breakpoint

-- 10. Xóa một tài khoản chờ đã đủ điều kiện: kiểm LẠI mọi điều kiện trong cùng câu lệnh (người vừa nhận
--     tài khoản hoặc vừa tham gia lại giữa lúc việc chạy thì không bị xóa). Xóa dây chuyền users,
--     login_identities, sessions và dòng vai trò của tài khoản chờ; dòng 'removed' ở tài khoản cũ còn nguyên.
CREATE OR REPLACE FUNCTION account.purge_detached_account(
  p_account_id uuid,
  p_retention_days int,
  p_notice_days int
) RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
BEGIN
  IF p_retention_days <= p_notice_days OR p_notice_days < 1 THEN
    RAISE EXCEPTION 'purge_detached_account: tham số không hợp lệ' USING ERRCODE = '22023';
  END IF;
  DELETE FROM account.accounts a
   WHERE a.id = p_account_id
     AND a.status = 'unclaimed'
     AND EXISTS (
       SELECT 1 FROM account.users u
        WHERE u.account_id = a.id
          AND u.detached_at <= now() - make_interval(days => p_retention_days)
          AND u.deletion_notice_sent_at <= now() - make_interval(days => p_notice_days))
     AND NOT EXISTS (
       SELECT 1 FROM account.users u
        WHERE u.account_id = a.id
          AND (u.detached_at IS NULL
               OR u.detached_at > now() - make_interval(days => p_retention_days)
               OR u.deletion_notice_sent_at IS NULL
               OR u.deletion_notice_sent_at > now() - make_interval(days => p_notice_days)));
  RETURN FOUND;
END
$$;
--> statement-breakpoint
ALTER FUNCTION account.purge_detached_account(uuid, int, int) OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.purge_detached_account(uuid, int, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.purge_detached_account(uuid, int, int) TO "system";
--> statement-breakpoint

-- 11. Dọn dẹp định kỳ: lời mời 'pending' quá hạn → 'expired' (trả danh sách vừa hết hạn để Worker ghi
--     kiểm toán – chạy lần hai trả rỗng); xóa lời mời đã đóng > 90 ngày; xóa former_members > 12 tháng.
CREATE OR REPLACE FUNCTION account.auth_housekeeping()
  RETURNS TABLE (account_id uuid, invitation_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, account
AS $$
BEGIN
  DELETE FROM account.invitations i
   WHERE i.status <> 'pending' AND i.closed_at < now() - interval '90 days';
  DELETE FROM account.former_members f WHERE f.removed_at < now() - interval '12 months';
  RETURN QUERY
    UPDATE account.invitations i
       SET status = 'expired', closed_at = now(), updated_at = now()
     WHERE i.status = 'pending' AND i.expires_at <= now()
    RETURNING i.account_id, i.id;
END
$$;
--> statement-breakpoint
ALTER FUNCTION account.auth_housekeeping() OWNER TO "owner";
--> statement-breakpoint
REVOKE ALL ON FUNCTION account.auth_housekeeping() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION account.auth_housekeeping() TO "system";
