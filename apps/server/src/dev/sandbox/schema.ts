// Bảng trạng thái của bản giả lập (005, data-model.md mục 5, research R10) – schema `sandbox`, CHỈ
// migration dev (`drizzle/migrations-dev`, áp khi APP_ENV ∈ {development, test}). Không bao giờ lọt vào
// migration chính. Tiền tố tên theo module chủ: `pg_fake_*` (Cổng nền tảng), `ai_fake_*` (Cổng AI),
// `ntf_fake_*` (Thông báo); `fake_scenarios` dùng chung. Chỉ src/dev/** và modules/*/internal/fake/** được
// nhập tệp này (quy tắc ranh giới `dev-only-restricted`).
// Nhập thẳng core/db (không qua core/index.ts) để drizzle-kit nạp lược đồ không kéo theo NestJS.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { microUsd, moduleSchema, sharedTable, tenantTable } from '../../core/db';
import { uuidV7 } from '../../core/ids/uuid-v7';
import { FAKE_COMPONENTS } from '../fake-components';

const sandbox = moduleSchema('sandbox');

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

// ---------------------------------------------------------------------------------------------
// Dùng chung: kịch bản giả lập (contracts/runtime-config.md mục 3)
// ---------------------------------------------------------------------------------------------

/** Kịch bản theo tài khoản: `target` = `connection:{id}`, `oauth`, `*`…; hết `remaining_uses` → tự xóa. */
export const fakeScenarios = tenantTable(
  sandbox,
  'fake_scenarios',
  {
    component: text('component', { enum: FAKE_COMPONENTS }).notNull(),
    target: text('target').notNull(),
    spec: jsonb('spec').notNull(),
    remaining_uses: integer('remaining_uses'),
  },
  (t) => [
    index('fake_scenarios_account_component_target_idx').on(t.account_id, t.component, t.target),
    check(
      'fake_scenarios_component_check',
      sql`${t.component} IN ('platform', 'ai', 'notifications', 'mail')`,
    ),
    check(
      'fake_scenarios_remaining_uses_check',
      sql`${t.remaining_uses} IS NULL OR ${t.remaining_uses} >= 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// Cổng nền tảng (contracts/platform-gateway.md mục 3–4)
// ---------------------------------------------------------------------------------------------

/** Mã trạng thái chống giả mạo của luồng kết nối: lưu SHA-256, hạn 10 phút, dùng một lần. */
export const pgFakeOauthStates = tenantTable(
  sandbox,
  'pg_fake_oauth_states',
  {
    state_hash: bytea('state_hash').notNull(),
    user_id: uuid('user_id').notNull(),
    channel_type: text('channel_type').notNull(),
    expires_at: timestamptz('expires_at').notNull(),
    used_at: timestamptz('used_at'),
  },
  (t) => [uniqueIndex('pg_fake_oauth_states_state_hash_key').on(t.account_id, t.state_hash)],
);

/** Phiên chọn Page/tài khoản sau lượt gọi lại (hạn 10 phút). `candidates` không chứa mã quyền thô. */
export const pgFakeSelections = tenantTable(sandbox, 'pg_fake_selections', {
  channel_type: text('channel_type').notNull(),
  user_id: uuid('user_id').notNull(),
  candidates: jsonb('candidates').notNull(),
  expires_at: timestamptz('expires_at').notNull(),
  used_at: timestamptz('used_at'),
});

export const PG_FAKE_CONNECTION_STATUSES = ['active', 'disconnected'] as const;

/** Kết nối kênh giả; mã quyền giả mã hóa AES-GCM (FakeCredentialVault). */
export const pgFakeConnections = tenantTable(
  sandbox,
  'pg_fake_connections',
  {
    channel_type: text('channel_type').notNull(),
    external_id: text('external_id').notNull(),
    display_name: text('display_name').notNull(),
    token_ciphertext: bytea('token_ciphertext').notNull(),
    token_expires_at: timestamptz('token_expires_at').notNull(),
    status: text('status', { enum: PG_FAKE_CONNECTION_STATUSES }).notNull().default('active'),
    connected_at: timestamptz('connected_at').notNull().defaultNow(),
    disconnected_at: timestamptz('disconnected_at'),
  },
  (t) => [
    uniqueIndex('pg_fake_connections_live_key')
      .on(t.account_id, t.channel_type, t.external_id)
      .where(sql`status <> 'disconnected'`),
    check('pg_fake_connections_status_check', sql`${t.status} IN ('active', 'disconnected')`),
  ],
);

export const PG_FAKE_POST_STATES = ['processing', 'published', 'failed'] as const;

/**
 * Bài "đã lên" nền tảng giả. KHÔNG unique theo dấu nội dung – cố ý để lộ đăng trùng (bộ kiểm thử đếm
 * `publishedCount`). `stored_text_hash` = dấu tính lại trên chữ "nền tảng đổi nhẹ" (đối soát).
 */
export const pgFakePosts = tenantTable(
  sandbox,
  'pg_fake_posts',
  {
    connection_id: uuid('connection_id').notNull(),
    platform_post_id: text('platform_post_id').notNull(),
    content_hash: text('content_hash').notNull(),
    stored_text_hash: text('stored_text_hash').notNull(),
    permalink: text('permalink').notNull(),
    state: text('state', { enum: PG_FAKE_POST_STATES }).notNull(),
    processing_id: text('processing_id'),
    /** Kết quả khi hết xử lý (`processing_then_done` | `processing_then_failed`). */
    processing_outcome: text('processing_outcome'),
    published_at: timestamptz('published_at'),
  },
  (t) => [
    index('pg_fake_posts_account_connection_hash_idx').on(
      t.account_id,
      t.connection_id,
      t.content_hash,
    ),
    check('pg_fake_posts_state_check', sql`${t.state} IN ('processing', 'published', 'failed')`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Cổng AI (contracts/ai-gateway.md mục 3–4, research R7, R8)
// ---------------------------------------------------------------------------------------------

export const AI_RESERVATION_STATES = ['held', 'calling', 'settled', 'released'] as const;
export const AI_LEDGER_ANOMALIES = ['over_estimate', 'unsettled'] as const;

/** Ngân sách giả của tài khoản theo chu kỳ. Bất biến `used + reserved <= cap` là chốt cuối (CHECK). */
export const aiFakeBudgets = tenantTable(
  sandbox,
  'ai_fake_budgets',
  {
    cycle_start: date('cycle_start', { mode: 'string' }).notNull(),
    used: microUsd('used')
      .notNull()
      .default(sql`0`),
    reserved: microUsd('reserved')
      .notNull()
      .default(sql`0`),
    cap: microUsd('cap').notNull(),
    soft_limit: microUsd('soft_limit').notNull(),
    notified_80: boolean('notified_80').notNull().default(false),
    notified_100: boolean('notified_100').notNull().default(false),
  },
  (t) => [
    uniqueIndex('ai_fake_budgets_cycle_key').on(t.account_id, t.cycle_start),
    check(
      'ai_fake_budgets_within_cap',
      sql`${t.used} >= 0 AND ${t.reserved} >= 0 AND ${t.used} + ${t.reserved} <= ${t.cap}`,
    ),
  ],
);

export const aiFakeReservations = tenantTable(
  sandbox,
  'ai_fake_reservations',
  {
    cycle_start: date('cycle_start', { mode: 'string' }).notNull(),
    estimate: microUsd('estimate').notNull(),
    model_tier: text('model_tier').notNull(),
    task: text('task').notNull(),
    state: text('state', { enum: AI_RESERVATION_STATES }).notNull().default('held'),
    reserved_at: timestamptz('reserved_at').notNull().defaultNow(),
    called_at: timestamptz('called_at'),
    closed_at: timestamptz('closed_at'),
  },
  (t) => [
    index('ai_fake_reservations_account_state_idx').on(t.account_id, t.state, t.reserved_at),
    check(
      'ai_fake_reservations_state_check',
      sql`${t.state} IN ('held', 'calling', 'settled', 'released')`,
    ),
    check('ai_fake_reservations_estimate_non_negative', sql`${t.estimate} >= 0`),
  ],
);

/** Cột chung của sổ chi phí (tài khoản + hệ thống). Tiền micro-USD; `cost_micro_usd` là chi phí THỰC. */
function ledgerColumns() {
  return {
    reservation_id: uuid('reservation_id').notNull(),
    task: text('task').notNull(),
    model_tier: text('model_tier').notNull(),
    model_id: text('model_id').notNull(),
    provider: text('provider').notNull(),
    input_tokens: integer('input_tokens').notNull(),
    output_tokens: integer('output_tokens').notNull(),
    cached_input_tokens: integer('cached_input_tokens').notNull(),
    cost_micro_usd: microUsd('cost_micro_usd').notNull(),
    estimate_micro_usd: microUsd('estimate_micro_usd').notNull(),
    anomaly: text('anomaly', { enum: AI_LEDGER_ANOMALIES }),
    over_cap_micro_usd: microUsd('over_cap_micro_usd')
      .notNull()
      .default(sql`0`),
    trace_id: text('trace_id'),
  };
}

export const aiFakeCostLedger = tenantTable(
  sandbox,
  'ai_fake_cost_ledger',
  { cycle_start: date('cycle_start', { mode: 'string' }).notNull(), ...ledgerColumns() },
  (t) => [
    index('ai_fake_cost_ledger_account_cycle_idx').on(t.account_id, t.cycle_start),
    check(
      'ai_fake_cost_ledger_anomaly_check',
      sql`${t.anomaly} IS NULL OR ${t.anomaly} IN ('over_estimate', 'unsettled')`,
    ),
  ],
);

/** Ngân sách hệ thống theo tuần (xu hướng – FR-038). Chỉ vai trò `system` ghi. */
export const aiFakeSystemBudgets = sharedTable(
  sandbox,
  'ai_fake_system_budgets',
  {
    week_start: date('week_start', { mode: 'string' }).notNull(),
    used: microUsd('used')
      .notNull()
      .default(sql`0`),
    reserved: microUsd('reserved')
      .notNull()
      .default(sql`0`),
    cap: microUsd('cap').notNull(),
    soft_limit: microUsd('soft_limit').notNull(),
    created_at: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'ai_fake_system_budgets_pkey', columns: [t.week_start] }),
    check(
      'ai_fake_system_budgets_within_cap',
      sql`${t.used} >= 0 AND ${t.reserved} >= 0 AND ${t.used} + ${t.reserved} <= ${t.cap}`,
    ),
  ],
  { reason: 'ngân sách AI của việc hệ thống (xu hướng theo ngành) – không thuộc tài khoản nào' },
);

export const aiFakeSystemReservations = sharedTable(
  sandbox,
  'ai_fake_system_reservations',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidV7()),
    week_start: date('week_start', { mode: 'string' }).notNull(),
    industry_id: uuid('industry_id'),
    estimate: microUsd('estimate').notNull(),
    model_tier: text('model_tier').notNull(),
    task: text('task').notNull(),
    state: text('state', { enum: AI_RESERVATION_STATES }).notNull().default('held'),
    reserved_at: timestamptz('reserved_at').notNull().defaultNow(),
    called_at: timestamptz('called_at'),
    closed_at: timestamptz('closed_at'),
  },
  (t) => [
    index('ai_fake_system_reservations_state_idx').on(t.state, t.reserved_at),
    check(
      'ai_fake_system_reservations_state_check',
      sql`${t.state} IN ('held', 'calling', 'settled', 'released')`,
    ),
  ],
  { reason: 'giữ chỗ ngân sách của việc hệ thống – không thuộc tài khoản nào' },
);

export const aiFakeSystemCostLedger = sharedTable(
  sandbox,
  'ai_fake_system_cost_ledger',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidV7()),
    week_start: date('week_start', { mode: 'string' }).notNull(),
    industry_id: uuid('industry_id'),
    ...ledgerColumns(),
    created_at: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('ai_fake_system_cost_ledger_week_idx').on(t.week_start)],
  { reason: 'sổ chi phí AI của việc hệ thống (xu hướng theo ngành) – không thuộc tài khoản nào' },
);

// ---------------------------------------------------------------------------------------------
// Thông báo (contracts/notifications.md mục 4, 6)
// ---------------------------------------------------------------------------------------------

/** Dòng sự kiện – chỉ mục duy nhất `(account_id, dedupe_key)` quyết định chống trùng (vĩnh viễn). */
export const ntfFakeEvents = tenantTable(
  sandbox,
  'ntf_fake_events',
  {
    dedupe_key: text('dedupe_key').notNull(),
    type: text('type').notNull(),
    refs: jsonb('refs').notNull(),
  },
  (t) => [uniqueIndex('ntf_fake_events_dedupe_key').on(t.account_id, t.dedupe_key)],
);

/** Thông báo đã gửi (mỗi người nhận × kênh). `email_result`: `sent` | `transient` | `permanent`. */
export const ntfFakeNotifications = tenantTable(
  sandbox,
  'ntf_fake_notifications',
  {
    dedupe_key: text('dedupe_key').notNull(),
    type: text('type').notNull(),
    recipient_user_id: uuid('recipient_user_id').notNull(),
    channel: text('channel', { enum: ['in_app', 'email'] }).notNull(),
    email_batch: text('email_batch', { enum: ['batch_10m', 'immediate'] }),
    title_vi: text('title_vi').notNull(),
    body_vi: text('body_vi').notNull(),
    actions: jsonb('actions').notNull(),
    refs: jsonb('refs').notNull(),
    email_result: text('email_result'),
  },
  (t) => [
    uniqueIndex('ntf_fake_notifications_recipient_key').on(
      t.account_id,
      t.dedupe_key,
      t.recipient_user_id,
      t.channel,
    ),
    check('ntf_fake_notifications_channel_check', sql`${t.channel} IN ('in_app', 'email')`),
  ],
);
