// Bảng của module Cổng nền tảng (010, data-model.md mục 1–6). Migration CHỈ THÊM (tương thích ngược – API/Worker
// bản cũ và mới chạy song song); khung nhìn hỗ trợ, hàm SECURITY DEFINER, quyền và dữ liệu gốc viết tay ở
// migration `0025_platform_gateway_010_functions.sql`.
//
// Mã quyền (`token_ciphertext`, `refresh_ciphertext`, `candidates[*].tokenCiphertextB64`) CHỈ ở dạng đã mã hóa
// bằng CredentialVault (Hiến pháp VII). `account_id` luôn lấy từ phiên; không bảng nào có khóa ngoại sang module khác
// (ADR-09) – `user_id`, `changed_by_staff_id` là mã tham chiếu.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { moduleSchema, sharedTable, tenantTable } from '../../../../core/db';

const platformGateway = moduleSchema('platform_gateway');
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** `bytea` ↔ Buffer (bản mã phong bì, băm SHA-256 của `state`). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const CONNECTION_CHANNEL_TYPES = [
  'facebook_page',
  'instagram',
  'tiktok',
  'zalo_oa',
  'test_channel',
] as const;

/** Trạng thái LƯU. `expiring` và `suspended` là dẫn xuất (R4) nên không có ở đây. */
export const CONNECTION_STATUS_LIST = [
  'active',
  'needs_reconnect',
  'ineligible',
  'disconnected',
] as const;
export type ConnectionRowStatus = (typeof CONNECTION_STATUS_LIST)[number];

export const EXPIRY_KINDS = ['none', 'token', 'data_access'] as const;
export const NOTIFIED_STAGES = ['d7', 'd1', 'expired'] as const;

/** Khóa công tắc hợp lệ (giai đoạn 1 chỉ `channel.tiktok`); thêm khóa = migration thêm CHECK mới. */
export const FEATURE_FLAG_KEYS = ['channel.tiktok'] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

/** Giá trị công tắc theo tài khoản: bật, tắt, hoặc theo mặc định hệ thống (= không có dòng ghi đè). */
export const FEATURE_VALUES = ['on', 'off', 'default'] as const;
export type FeatureValue = (typeof FEATURE_VALUES)[number];

/**
 * Kết nối kênh. Hàng định danh được GIỮ khi ngắt (để truy vết lượt đăng); chỉ hai cột bản mã bị đặt NULL (FR-017).
 * Chỉ mục duy nhất toàn cục `(channel_type, external_id)` là ngoại lệ của quy tắc "chỉ mục bắt đầu bằng account_id":
 * một Page chỉ thuộc một tài khoản (FR-006) và chỉ cơ sở dữ liệu chặn được khi hai tài khoản đua nhau.
 */
export const channelConnections = tenantTable(
  platformGateway,
  'channel_connections',
  {
    channel_type: text('channel_type').notNull(),
    external_id: text('external_id').notNull(),
    display_name: varchar('display_name', { length: 120 }).notNull(),
    avatar_url: text('avatar_url'),
    account_type: text('account_type'),
    granted_scopes: text('granted_scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    quota_remaining: integer('quota_remaining'),
    /** Chỉ Instagram: Page nguồn (FR-042). Cùng module nên được phép có khóa ngoại. */
    source_connection_id: uuid('source_connection_id'),
    /** Chỉ Instagram: `external_id` của Page nguồn lúc kết nối – để liên kết về sau khi Page được kết nối (T045). */
    source_external_id: text('source_external_id'),
    /** Bản mã (`v1 | keyId | wrappedDek | iv | tag | ciphertext`). NULL chỉ khi `status='disconnected'`. */
    token_ciphertext: bytea('token_ciphertext'),
    refresh_ciphertext: bytea('refresh_ciphertext'),
    /** Bản mới hơn thắng khi Worker làm mới đua với người dùng kết nối lại. */
    token_issued_at: timestamptz('token_issued_at').notNull(),
    expiry_kind: text('expiry_kind', { enum: EXPIRY_KINDS }).notNull().default('token'),
    /** NULL ⇔ `expiry_kind = 'none'`. */
    token_expires_at: timestamptz('token_expires_at'),
    status: text('status', { enum: CONNECTION_STATUS_LIST }).notNull().default('active'),
    reason_code: text('reason_code'),
    last_error_code: text('last_error_code'),
    last_checked_at: timestamptz('last_checked_at'),
    last_refreshed_at: timestamptz('last_refreshed_at'),
    last_manual_check_at: timestamptz('last_manual_check_at'),
    recheck_required: boolean('recheck_required').notNull().default(false),
    last_notified_stage: text('last_notified_stage', { enum: NOTIFIED_STAGES }),
    connected_at: timestamptz('connected_at').notNull(),
    disconnected_at: timestamptz('disconnected_at'),
  },
  (t) => [
    foreignKey({
      name: 'channel_connections_source_fk',
      columns: [t.source_connection_id],
      foreignColumns: [t.id],
    }).onDelete('set null'),
    check(
      'channel_connections_channel_type_check',
      sql`${t.channel_type} IN ('facebook_page', 'instagram', 'tiktok', 'zalo_oa', 'test_channel')`,
    ),
    check(
      'channel_connections_status_check',
      sql`${t.status} IN ('active', 'needs_reconnect', 'ineligible', 'disconnected')`,
    ),
    check(
      'channel_connections_expiry_kind_check',
      sql`${t.expiry_kind} IN ('none', 'token', 'data_access')`,
    ),
    check(
      'channel_connections_last_notified_stage_check',
      sql`${t.last_notified_stage} IS NULL OR ${t.last_notified_stage} IN ('d7', 'd1', 'expired')`,
    ),
    check(
      'channel_connections_disconnected_check',
      sql`(${t.status} = 'disconnected') = (${t.disconnected_at} IS NOT NULL)`,
    ),
    check(
      'channel_connections_expiry_check',
      sql`(${t.expiry_kind} = 'none') = (${t.token_expires_at} IS NULL)`,
    ),
    check(
      'channel_connections_source_only_instagram',
      sql`${t.channel_type} = 'instagram' OR ${t.source_connection_id} IS NULL`,
    ),
    check(
      'channel_connections_source_not_self',
      sql`${t.source_connection_id} IS DISTINCT FROM ${t.id}`,
    ),
    // Còn kết nối thì phải có mã quyền; đã ngắt thì bản mã bị xóa ngay (FR-017).
    check(
      'channel_connections_token_present',
      sql`(${t.status} = 'disconnected') OR ${t.token_ciphertext} IS NOT NULL`,
    ),
    check(
      'channel_connections_disconnected_no_token',
      sql`${t.status} <> 'disconnected' OR (${t.token_ciphertext} IS NULL AND ${t.refresh_ciphertext} IS NULL)`,
    ),
    check(
      'channel_connections_external_id_length',
      sql`char_length(${t.external_id}) BETWEEN 1 AND 200`,
    ),
    check(
      'channel_connections_avatar_url_check',
      sql`${t.avatar_url} IS NULL OR (${t.avatar_url} ~ '^https://' AND char_length(${t.avatar_url}) <= 500)`,
    ),
    check(
      'channel_connections_reason_code_check',
      sql`${t.reason_code} IS NULL OR ${t.reason_code} ~ '^[A-Za-z0-9_.:-]{1,64}$'`,
    ),
    check(
      'channel_connections_last_error_code_check',
      sql`${t.last_error_code} IS NULL OR ${t.last_error_code} ~ '^[A-Za-z0-9_.:-]{1,64}$'`,
    ),
    // FR-006: một Page/tài khoản chỉ thuộc MỘT tài khoản khách hàng (kết nối chưa ngắt).
    uniqueIndex('channel_connections_channel_external_active_key')
      .on(t.channel_type, t.external_id)
      .where(sql`${t.status} <> 'disconnected'`),
    index('channel_connections_account_type_idx')
      .on(t.account_id, t.channel_type)
      .where(sql`${t.status} <> 'disconnected'`),
    index('channel_connections_source_idx')
      .on(t.account_id, t.source_connection_id)
      .where(sql`${t.source_connection_id} IS NOT NULL`),
    // Quét định kỳ của hệ thống (`list_due_connections`): quét theo hạn/lần kiểm tra, không theo tenant.
    index('channel_connections_due_expiry_idx')
      .on(t.token_expires_at)
      .where(sql`${t.status} = 'active'`),
    index('channel_connections_due_checked_idx')
      .on(t.last_checked_at)
      .where(sql`${t.status} = 'active'`),
  ],
  {
    versioned: true,
    indexExceptions: {
      channel_connections_channel_external_active_key:
        'FR-006: một Page chỉ thuộc một tài khoản – chỉ CSDL chặn được khi hai tài khoản đua nhau',
      channel_connections_due_expiry_idx:
        'Quét định kỳ toàn hệ thống theo hạn quyền (hàm list_due_connections, không lọc theo tenant)',
      channel_connections_due_checked_idx:
        'Quét định kỳ toàn hệ thống theo lần kiểm tra gần nhất (hàm list_due_connections)',
    },
  },
);

/** Chống giả mạo luồng cấp quyền: `state` ngẫu nhiên 32 byte, chỉ lưu băm, dùng một lần. */
export const connectStates = tenantTable(
  platformGateway,
  'connect_states',
  {
    state_hash: bytea('state_hash').notNull(),
    /** Mã tham chiếu người khởi động (không khóa ngoại – ADR-09). */
    user_id: uuid('user_id').notNull(),
    channel_type: text('channel_type').notNull(),
    reconnect_connection_id: uuid('reconnect_connection_id').references(
      () => channelConnections.id,
      { onDelete: 'cascade' },
    ),
    expires_at: timestamptz('expires_at').notNull(),
    used_at: timestamptz('used_at'),
  },
  (t) => [
    check(
      'connect_states_channel_type_check',
      sql`${t.channel_type} IN ('facebook_page', 'instagram', 'tiktok')`,
    ),
    // Tra theo băm trong ngữ cảnh một tài khoản (callback có phiên) nên chỉ mục bắt đầu bằng account_id.
    uniqueIndex('connect_states_account_state_hash_key').on(t.account_id, t.state_hash),
    index('connect_states_account_expires_idx').on(t.account_id, t.expires_at),
  ],
);

/**
 * Phiên chọn Page/tài khoản (dữ liệu tạm). Mỗi ứng viên mang mã quyền ĐÃ MÃ HÓA riêng (AAD gắn selection + external_id);
 * dòng bị xóa hẳn sau `confirm` hoặc hết hạn – mã của ứng viên không được chọn bị hủy cùng dòng.
 */
export const connectSelections = tenantTable(
  platformGateway,
  'connect_selections',
  {
    user_id: uuid('user_id').notNull(),
    channel_type: text('channel_type').notNull(),
    candidates: jsonb('candidates').notNull(),
    expires_at: timestamptz('expires_at').notNull(),
    used_at: timestamptz('used_at'),
  },
  (t) => [
    check(
      'connect_selections_channel_type_check',
      sql`${t.channel_type} IN ('facebook_page', 'instagram', 'tiktok')`,
    ),
    check(
      'connect_selections_candidates_check',
      sql`jsonb_typeof(${t.candidates}) = 'array' AND jsonb_array_length(${t.candidates}) <= 100`,
    ),
    index('connect_selections_account_expires_idx').on(t.account_id, t.expires_at),
  ],
);

/** Ghi đè công tắc theo tài khoản. "Theo mặc định" = không có dòng (xóa dòng). */
export const featureOverrides = tenantTable(
  platformGateway,
  'feature_overrides',
  {
    flag_key: text('flag_key').notNull(),
    value: boolean('value').notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    /** Mã tham chiếu nhân viên (không khóa ngoại – ADR-09). */
    changed_by_staff_id: uuid('changed_by_staff_id').notNull(),
  },
  (t) => [
    check('feature_overrides_flag_key_check', sql`${t.flag_key} IN ('channel.tiktok')`),
    check('feature_overrides_reason_check', sql`char_length(${t.reason}) BETWEEN 1 AND 500`),
    uniqueIndex('feature_overrides_account_flag_key').on(t.account_id, t.flag_key),
  ],
);

/** Nhật ký đổi công tắc – CHỈ THÊM (quyền SQL của `app` chỉ INSERT, SELECT; xem migration 0025). Giữ 12 tháng. */
export const featureOverrideEvents = tenantTable(
  platformGateway,
  'feature_override_events',
  {
    flag_key: text('flag_key').notNull(),
    old_value: text('old_value', { enum: FEATURE_VALUES }).notNull(),
    new_value: text('new_value', { enum: FEATURE_VALUES }).notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    changed_by_staff_id: uuid('changed_by_staff_id').notNull(),
    trace_id: text('trace_id').notNull(),
  },
  (t) => [
    check('feature_override_events_flag_key_check', sql`${t.flag_key} IN ('channel.tiktok')`),
    check(
      'feature_override_events_values_check',
      sql`${t.old_value} IN ('on', 'off', 'default') AND ${t.new_value} IN ('on', 'off', 'default')`,
    ),
    index('feature_override_events_account_created_idx').on(t.account_id, t.created_at),
  ],
);

/**
 * Cấu hình dùng chung của cổng (công tắc mặc định, giới hạn, ngưỡng). Không chứa dữ liệu khách hàng nên không
 * có `account_id`; chỉ quản trị nội bộ ghi (qua `features.service` có kiểm toán), ứng dụng chỉ ĐỌC.
 */
export const gatewaySettings = sharedTable(
  platformGateway,
  'gateway_settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    updated_at: timestamptz('updated_at').notNull().defaultNow(),
    /** Mã tham chiếu nhân viên (NULL = dữ liệu gốc của migration). */
    updated_by: uuid('updated_by'),
  },
  undefined,
  {
    reason:
      'Cấu hình toàn hệ thống (công tắc mặc định, giới hạn, ngưỡng nhắc) – không chứa dữ liệu khách hàng',
  },
);
