// Bảng của module Tài khoản & Gói – phần xác thực (004, data-model.md mục 2–3) và đăng nhập Google /
// Facebook, lời mời, thành viên cũ (009, data-model.md mục 1–3).
// 7 bảng tenant (RLS `tenant_isolation`, account_id đứng đầu chỉ mục trừ các ngoại lệ có lý do) và
// 5 bảng dùng chung (nhân viên nội bộ, phiên nhân viên, bộ đếm chống dò, lượt đăng nhập qua nhà cung
// cấp, yêu cầu của Meta). Bảng gốc account.accounts định nghĩa ở lõi (core/db/tenant-root.ts).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  inet,
  integer,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
// Nhập thẳng core/db (không qua core/index.ts) để drizzle-kit nạp lược đồ không kéo theo NestJS.
import { moduleSchema, sharedTable, tenantTable } from '../../../../core/db';
import { uuidV7 } from '../../../../core/ids/uuid-v7';

const account = moduleSchema('account');

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** `bytea` ↔ Buffer (băm SHA-256 của mã phiên/mã một lần, HMAC của khóa chống dò). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

// ---------------------------------------------------------------------------------------------
// Bảng tenant
// ---------------------------------------------------------------------------------------------

/** Người dùng khách hàng. Giai đoạn 1: thuộc đúng một tài khoản (`account_id`). */
export const users = tenantTable(
  account,
  'users',
  {
    display_name: text('display_name').notNull(),
    /** Dạng hiển thị (đã cắt khoảng trắng). */
    email: text('email').notNull(),
    /** trim → NFC → chữ thường. Duy nhất toàn cục. */
    email_normalized: text('email_normalized').notNull(),
    email_verified_at: timestamptz('email_verified_at'),
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    terms_version: text('terms_version').notNull(),
    terms_accepted_at: timestamptz('terms_accepted_at').notNull(),
    password_changed_at: timestamptz('password_changed_at'),
    /** 009: thời điểm bị gỡ khỏi tài khoản (đang ở tài khoản chờ); NULL khi thuộc một tài khoản thật. */
    detached_at: timestamptz('detached_at'),
    /** 009: đã gửi thư báo trước khi xóa (FR-028a). */
    deletion_notice_sent_at: timestamptz('deletion_notice_sent_at'),
  },
  (t) => [
    uniqueIndex('users_email_normalized_key').on(t.email_normalized),
    unique('users_account_id_id_key').on(t.account_id, t.id),
    check('users_status_check', sql`${t.status} IN ('active', 'disabled')`),
    check('users_display_name_length', sql`char_length(${t.display_name}) BETWEEN 1 AND 80`),
    check(
      'users_deletion_notice_check',
      sql`${t.deletion_notice_sent_at} IS NULL OR ${t.detached_at} IS NOT NULL`,
    ),
  ],
  {
    indexExceptions: {
      users_email_normalized_key: 'email duy nhất trên mọi tài khoản – FR-002',
    },
  },
);

/** Cách đăng nhập của người dùng (mật khẩu; Google/Facebook ở tính năng sau – FR-15). */
export const loginIdentities = tenantTable(
  account,
  'login_identities',
  {
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['password', 'google', 'facebook'] }).notNull(),
    /** Với `password`: bằng `user_id`. */
    provider_subject: text('provider_subject').notNull(),
    /** Chuỗi PHC argon2id; chỉ có với `password`. */
    password_hash: text('password_hash'),
    last_used_at: timestamptz('last_used_at'),
    /** 009: email và tên phía nhà cung cấp lúc liên kết (FR-014) – không có với `password`. */
    provider_email: text('provider_email'),
    provider_display_name: text('provider_display_name'),
  },
  (t) => [
    uniqueIndex('login_identities_provider_subject_key').on(t.provider, t.provider_subject),
    unique('login_identities_account_user_provider_key').on(t.account_id, t.user_id, t.provider),
    check(
      'login_identities_provider_check',
      sql`${t.provider} IN ('password', 'google', 'facebook')`,
    ),
    check(
      'login_identities_password_hash_check',
      sql`(${t.provider} = 'password') = (${t.password_hash} IS NOT NULL)`,
    ),
    check(
      'login_identities_provider_profile_check',
      sql`${t.provider} <> 'password' OR (${t.provider_email} IS NULL AND ${t.provider_display_name} IS NULL)`,
    ),
  ],
  {
    indexExceptions: {
      login_identities_provider_subject_key:
        'một danh tính của nhà cung cấp chỉ thuộc một người dùng trên mọi tài khoản – FR-003',
    },
  },
);

/** Vai trò trong tài khoản. Ghế: chủ = 0, cộng tác viên ∈ {1, 2} (R5). */
export const memberships = tenantTable(
  account,
  'memberships',
  {
    // 009 (data-model mục 1): MÃ THAM CHIẾU, không khóa ngoại. Sau khi gỡ, dòng `users` sang tài khoản
    // chờ còn dòng `removed` ở lại tài khoản cũ; khóa ngoại ON DELETE CASCADE sẽ xóa dòng này ở TENANT
    // KHÁC khi người dùng bị xóa sau 90 ngày. Mọi ghi vào bảng này đi qua dịch vụ/hàm của module.
    user_id: uuid('user_id').notNull(),
    role: text('role', { enum: ['owner', 'collaborator'] }).notNull(),
    seat: smallint('seat').notNull(),
    status: text('status', { enum: ['active', 'removed', 'disabled'] })
      .notNull()
      .default('active'),
    added_by_user_id: uuid('added_by_user_id'),
  },
  (t) => [
    uniqueIndex('memberships_account_seat_active_key')
      .on(t.account_id, t.seat)
      .where(sql`status = 'active'`),
    unique('memberships_account_user_key').on(t.account_id, t.user_id),
    check('memberships_role_check', sql`${t.role} IN ('owner', 'collaborator')`),
    check('memberships_status_check', sql`${t.status} IN ('active', 'removed', 'disabled')`),
    check('memberships_seat_range', sql`${t.seat} BETWEEN 0 AND 2`),
    check('memberships_owner_seat', sql`(${t.role} = 'owner') = (${t.seat} = 0)`),
    check('memberships_owner_active', sql`${t.role} <> 'owner' OR ${t.status} = 'active'`),
  ],
);

const SESSION_REVOKE_REASONS = [
  'logout',
  'logout_all',
  'password_changed',
  'password_reset',
  'email_verified',
  'member_removed',
  'user_disabled',
  // 009
  'identity_link_reset',
  'account_joined',
  'account_claimed',
] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

/** Phiên khách hàng – chỉ lưu SHA-256 của mã (R3). */
export const sessions = tenantTable(
  account,
  'sessions',
  {
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token_hash: bytea('token_hash').notNull(),
    last_seen_at: timestamptz('last_seen_at').notNull().defaultNow(),
    idle_expires_at: timestamptz('idle_expires_at').notNull(),
    absolute_expires_at: timestamptz('absolute_expires_at').notNull(),
    revoked_at: timestamptz('revoked_at'),
    revoke_reason: text('revoke_reason', { enum: SESSION_REVOKE_REASONS }),
    /** vd "Chrome · Android", ≤ 60 ký tự – không lưu chuỗi UA đầy đủ. */
    user_agent_summary: text('user_agent_summary'),
    /**
     * 009 (research R11): lần xác nhận lại danh tính gần nhất. Phiên "mới xác nhận" khi
     * coalesce(reauthenticated_at, created_at) ≥ now() − REAUTH_WINDOW_MINUTES. Phiên cấp do xoay vòng
     * (claim, accept-existing) mang mốc của phiên cũ.
     */
    reauthenticated_at: timestamptz('reauthenticated_at'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.token_hash),
    index('sessions_account_user_active_idx')
      .on(t.account_id, t.user_id)
      .where(sql`revoked_at IS NULL`),
    check(
      'sessions_revoke_reason_check',
      sql.raw(
        `revoke_reason IS NULL OR revoke_reason IN (${SESSION_REVOKE_REASONS.map((r) => `'${r}'`).join(', ')})`,
      ),
    ),
    check(
      'sessions_user_agent_summary_length',
      sql`${t.user_agent_summary} IS NULL OR char_length(${t.user_agent_summary}) <= 60`,
    ),
  ],
  {
    indexExceptions: {
      sessions_token_hash_key: 'tra phiên theo mã trước khi biết tenant – R3, R4',
    },
  },
);

/** Mã một lần: xác minh email (24 giờ), đặt lại mật khẩu (30 phút) – R8. */
export const authTokens = tenantTable(
  account,
  'auth_tokens',
  {
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['verify_email', 'reset_password'] }).notNull(),
    token_hash: bytea('token_hash').notNull(),
    /** Email mà mã áp dụng (với verify_email: email tại lúc gửi). */
    email_normalized: text('email_normalized').notNull(),
    expires_at: timestamptz('expires_at').notNull(),
    /** Đặt khi dùng hoặc khi có mã mới cùng mục đích thay thế. */
    used_at: timestamptz('used_at'),
  },
  (t) => [
    uniqueIndex('auth_tokens_token_hash_key').on(t.token_hash),
    index('auth_tokens_account_user_purpose_idx')
      .on(t.account_id, t.user_id, t.purpose)
      .where(sql`used_at IS NULL`),
    check('auth_tokens_purpose_check', sql`${t.purpose} IN ('verify_email', 'reset_password')`),
  ],
  {
    indexExceptions: {
      auth_tokens_token_hash_key: 'tra mã một lần trước khi biết tenant – R8',
    },
  },
);

export const INVITATION_STATUSES = ['pending', 'accepted', 'cancelled', 'expired'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/**
 * Lời mời cộng tác viên (009, data-model mục 2). Ghế trên lời mời + chỉ mục duy nhất theo ghế là chốt
 * chặn giới hạn 2 chỗ (research R9); mọi chuyển trạng thái là `UPDATE … WHERE status = 'pending'`.
 */
export const invitations = tenantTable(
  account,
  'invitations',
  {
    /** Dạng hiển thị. */
    email: text('email').notNull(),
    /** Cùng cách chuẩn hóa với `users`. */
    email_normalized: text('email_normalized').notNull(),
    invited_by_user_id: uuid('invited_by_user_id').notNull(),
    role: text('role', { enum: ['collaborator'] })
      .notNull()
      .default('collaborator'),
    seat: smallint('seat').notNull(),
    status: text('status', { enum: INVITATION_STATUSES }).notNull().default('pending'),
    /** SHA-256 của mã trong liên kết; đổi mỗi lần "Gửi lại". */
    token_hash: bytea('token_hash').notNull(),
    /** Tên cửa hàng lúc gửi (research R17). */
    account_label: text('account_label'),
    last_sent_at: timestamptz('last_sent_at').notNull(),
    expires_at: timestamptz('expires_at').notNull(),
    accepted_user_id: uuid('accepted_user_id'),
    /** Thời điểm rời `pending`. */
    closed_at: timestamptz('closed_at'),
  },
  (t) => [
    uniqueIndex('invitations_account_seat_pending_key')
      .on(t.account_id, t.seat)
      .where(sql`status = 'pending'`),
    uniqueIndex('invitations_account_email_pending_key')
      .on(t.account_id, t.email_normalized)
      .where(sql`status = 'pending'`),
    uniqueIndex('invitations_token_hash_key').on(t.token_hash),
    index('invitations_email_pending_idx')
      .on(t.email_normalized)
      .where(sql`status = 'pending'`),
    check('invitations_role_check', sql`${t.role} = 'collaborator'`),
    check('invitations_seat_range', sql`${t.seat} BETWEEN 1 AND 2`),
    check(
      'invitations_status_check',
      sql.raw(`status IN (${INVITATION_STATUSES.map((s) => `'${s}'`).join(', ')})`),
    ),
    check(
      'invitations_account_label_length',
      sql`${t.account_label} IS NULL OR char_length(${t.account_label}) <= 120`,
    ),
  ],
  {
    indexExceptions: {
      invitations_token_hash_key: 'tra lời mời theo mã trước khi biết tenant – FR-022',
      invitations_email_pending_idx:
        'liệt kê lời mời đang chờ của một email cho người ở tài khoản chờ – FR-027',
    },
  },
);

/**
 * Tên của thành viên đã gỡ (009, research R8) – để bài/media họ tạo vẫn hiện tên người tạo. Không lưu
 * email. Xóa khi người đó tham gia lại, hoặc sau 12 tháng.
 */
export const formerMembers = tenantTable(
  account,
  'former_members',
  {
    /** Mã tham chiếu, KHÔNG khóa ngoại: người dùng đã rời tenant, có thể đã bị xóa. */
    user_id: uuid('user_id').notNull(),
    /** Tên lúc bị gỡ. */
    display_name: text('display_name').notNull(),
    removed_at: timestamptz('removed_at').notNull().defaultNow(),
    removed_by_user_id: uuid('removed_by_user_id').notNull(),
  },
  (t) => [unique('former_members_account_user_key').on(t.account_id, t.user_id)],
);

// ---------------------------------------------------------------------------------------------
// Bảng dùng chung (không account_id) – chỉ truy cập qua authTx (ranh giới R4)
// ---------------------------------------------------------------------------------------------

/** Nhân viên nội bộ (hỗ trợ, quản trị) – không thuộc tài khoản khách hàng nào. */
export const staffUsers = sharedTable(
  account,
  'staff_users',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidV7()),
    email_normalized: text('email_normalized').notNull(),
    display_name: text('display_name').notNull(),
    role: text('role', { enum: ['support', 'admin'] }).notNull(),
    password_hash: text('password_hash').notNull(),
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    created_at: timestamptz('created_at').notNull().defaultNow(),
    updated_at: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
    password_changed_at: timestamptz('password_changed_at'),
  },
  (t) => [
    uniqueIndex('staff_users_email_normalized_key').on(t.email_normalized),
    check('staff_users_role_check', sql`${t.role} IN ('support', 'admin')`),
    check('staff_users_status_check', sql`${t.status} IN ('active', 'disabled')`),
  ],
  { reason: 'Nhân viên nội bộ không thuộc tài khoản khách hàng – FR-016' },
);

/** Phiên nhân viên nội bộ – như `sessions`, thêm mức xác thực (R10) và địa chỉ mạng. */
export const staffSessions = sharedTable(
  account,
  'staff_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidV7()),
    staff_user_id: uuid('staff_user_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'cascade' }),
    token_hash: bytea('token_hash').notNull(),
    created_at: timestamptz('created_at').notNull().defaultNow(),
    updated_at: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
    last_seen_at: timestamptz('last_seen_at').notNull().defaultNow(),
    idle_expires_at: timestamptz('idle_expires_at').notNull(),
    absolute_expires_at: timestamptz('absolute_expires_at').notNull(),
    revoked_at: timestamptz('revoked_at'),
    revoke_reason: text('revoke_reason'),
    user_agent_summary: text('user_agent_summary'),
    /** 'password' hiện tại; TOTP (trước ra mắt) thêm mức cao hơn mà không đổi cấu trúc. */
    assurance: text('assurance').notNull().default('password'),
    ip: inet('ip'),
  },
  (t) => [
    uniqueIndex('staff_sessions_token_hash_key').on(t.token_hash),
    index('staff_sessions_staff_user_active_idx')
      .on(t.staff_user_id)
      .where(sql`revoked_at IS NULL`),
    check(
      'staff_sessions_revoke_reason_check',
      sql`${t.revoke_reason} IS NULL OR ${t.revoke_reason} IN ('logout', 'staff_disabled', 'password_reset')`,
    ),
    check(
      'staff_sessions_user_agent_summary_length',
      sql`${t.user_agent_summary} IS NULL OR char_length(${t.user_agent_summary}) <= 60`,
    ),
  ],
  { reason: 'Phiên của nhân viên nội bộ – FR-010, FR-016' },
);

export const THROTTLE_KINDS = [
  'login_email',
  'login_ip',
  'mail_reset',
  'mail_verify',
  'register_ip',
  // 009 (data-model mục 5)
  'mail_invite',
  'invite_account',
  'mail_link_confirm',
  'oauth_start_ip',
] as const;
export type ThrottleKind = (typeof THROTTLE_KINDS)[number];

/** Bộ đếm chống dò – khóa là HMAC, không lưu email/địa chỉ mạng dạng rõ (R6). */
export const authThrottle = sharedTable(
  account,
  'auth_throttle',
  {
    kind: text('kind', { enum: THROTTLE_KINDS }).notNull(),
    key_hash: bytea('key_hash').notNull(),
    window_start: timestamptz('window_start').notNull(),
    count: integer('count').notNull(),
    blocked_until: timestamptz('blocked_until'),
  },
  (t) => [
    primaryKey({ name: 'auth_throttle_pkey', columns: [t.kind, t.key_hash] }),
    check(
      'auth_throttle_kind_check',
      sql.raw(`kind IN (${THROTTLE_KINDS.map((k) => `'${k}'`).join(', ')})`),
    ),
  ],
  { reason: 'Bộ đếm chống dò theo email/địa chỉ mạng trước khi biết tenant – FR-007' },
);

export const OAUTH_PROVIDERS = ['google', 'facebook'] as const;
export const OAUTH_PURPOSES = ['login', 'link', 'reauth', 'invite'] as const;
export type OAuthPurpose = (typeof OAUTH_PURPOSES)[number];
export const OAUTH_FLOW_STAGES = [
  'started',
  'signed_in',
  'needs_signup',
  'needs_email',
  'needs_link_confirm',
  'awaiting_email',
  'completed',
  'failed',
] as const;
export type OAuthFlowStage = (typeof OAUTH_FLOW_STAGES)[number];

const quoted = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');

/**
 * Lượt đăng nhập qua nhà cung cấp + phần chờ xác nhận (009, research R5, data-model mục 3). Sống ≤ 24
 * giờ, việc định kỳ xóa. Mọi chuyển giai đoạn: `UPDATE … WHERE id AND stage = $expected AND
 * expires_at > now()`. Cột tài khoản đích tên `target_tenant_id` (không phải `account_id`) vì đây là
 * bảng dùng chung, không có RLS.
 */
export const oauthFlows = sharedTable(
  account,
  'oauth_flows',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidV7()),
    /** SHA-256 của cookie `__Host-oauth`. */
    flow_token_hash: bytea('flow_token_hash').notNull(),
    /** SHA-256 của `state` gửi nhà cung cấp. */
    state_hash: bytea('state_hash').notNull(),
    /** Chỉ Google (PKCE); về NULL ngay khi quay về. */
    code_verifier: text('code_verifier'),
    provider: text('provider', { enum: OAUTH_PROVIDERS }).notNull(),
    purpose: text('purpose', { enum: OAUTH_PURPOSES }).notNull(),
    stage: text('stage', { enum: OAUTH_FLOW_STAGES }).notNull().default('started'),
    /** Người đang đăng nhập (`link`, `reauth`). */
    actor_user_id: uuid('actor_user_id'),
    /** Lời mời (`invite`). */
    invitation_id: uuid('invitation_id'),
    terms_version: text('terms_version'),
    terms_accepted_at: timestamptz('terms_accepted_at'),
    /** Có sau khi quay về. */
    provider_subject: text('provider_subject'),
    provider_email: text('provider_email'),
    provider_email_verified: boolean('provider_email_verified').notNull().default(false),
    provider_display_name: text('provider_display_name'),
    /** Người dùng nhập ở bước hoàn tất. */
    claimed_email: text('claimed_email'),
    claimed_email_normalized: text('claimed_email_normalized'),
    display_name: text('display_name'),
    /** Người dùng đã có cần xác nhận liên kết. */
    target_user_id: uuid('target_user_id'),
    target_tenant_id: uuid('target_tenant_id'),
    /** Cách (a) của FR-011 – xác nhận bằng mật khẩu – được phép. */
    password_allowed: boolean('password_allowed').notNull().default(false),
    /** Băm mã trong liên kết gửi email. */
    mail_token_hash: bytea('mail_token_hash'),
    /** Mã kết quả/lỗi cho web (không phải mã của nhà cung cấp). */
    result_code: text('result_code'),
    expires_at: timestamptz('expires_at').notNull(),
    created_at: timestamptz('created_at').notNull().defaultNow(),
    updated_at: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
    closed_at: timestamptz('closed_at'),
  },
  (t) => [
    uniqueIndex('oauth_flows_flow_token_hash_key').on(t.flow_token_hash),
    uniqueIndex('oauth_flows_mail_token_hash_key').on(t.mail_token_hash),
    index('oauth_flows_expires_at_idx').on(t.expires_at),
    check('oauth_flows_provider_check', sql.raw(`provider IN (${quoted(OAUTH_PROVIDERS)})`)),
    check('oauth_flows_purpose_check', sql.raw(`purpose IN (${quoted(OAUTH_PURPOSES)})`)),
    check('oauth_flows_stage_check', sql.raw(`stage IN (${quoted(OAUTH_FLOW_STAGES)})`)),
  ],
  {
    reason:
      'Lượt đăng nhập qua nhà cung cấp và yêu cầu xác nhận liên kết xảy ra trước khi biết tenant – FR-007, FR-010',
  },
);

/**
 * Yêu cầu gỡ ứng dụng / xóa dữ liệu của Meta (009, FR-009a). Chỉ lưu HMAC của mã người dùng Facebook
 * (nhận ra thông báo lặp) và mã xác nhận ngẫu nhiên – không có mã rõ. Giữ 12 tháng.
 */
export const metaDeletionRequests = sharedTable(
  account,
  'meta_deletion_requests',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidV7()),
    /** Ngẫu nhiên 16 byte, base64url. */
    confirmation_code: text('confirmation_code').notNull(),
    kind: text('kind', { enum: ['deauthorize', 'data_deletion'] }).notNull(),
    subject_hmac: bytea('subject_hmac').notNull(),
    /** Tạo với `no_data`; chuyển `completed` khi đã xóa được danh tính. */
    status: text('status', { enum: ['completed', 'no_data'] })
      .notNull()
      .default('no_data'),
    received_at: timestamptz('received_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('meta_deletion_requests_confirmation_code_key').on(t.confirmation_code),
    unique('meta_deletion_requests_kind_subject_key').on(t.kind, t.subject_hmac),
    check('meta_deletion_requests_kind_check', sql`${t.kind} IN ('deauthorize', 'data_deletion')`),
    check('meta_deletion_requests_status_check', sql`${t.status} IN ('completed', 'no_data')`),
  ],
  {
    reason:
      'Yêu cầu của Meta không gắn tài khoản khách hàng và trang trạng thái là công khai – FR-009a',
  },
);
