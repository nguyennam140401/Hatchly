// Bảng của module Tài khoản & Gói – phần xác thực (004, data-model.md mục 2–3).
// 5 bảng tenant (RLS `tenant_isolation`, account_id đứng đầu chỉ mục trừ các ngoại lệ có lý do) và
// 3 bảng dùng chung (nhân viên nội bộ, phiên nhân viên, bộ đếm chống dò). Bảng gốc account.accounts
// định nghĩa ở lõi (core/db/tenant-root.ts).
import { sql } from 'drizzle-orm';
import {
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
  },
  (t) => [
    uniqueIndex('users_email_normalized_key').on(t.email_normalized),
    unique('users_account_id_id_key').on(t.account_id, t.id),
    check('users_status_check', sql`${t.status} IN ('active', 'disabled')`),
    check('users_display_name_length', sql`char_length(${t.display_name}) BETWEEN 1 AND 80`),
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
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
