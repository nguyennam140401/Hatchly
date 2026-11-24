// Bảng của module Cổng AI thật (015, data-model.md). Migration CHỈ THÊM (tương thích ngược – API/Worker bản cũ và
// mới chạy song song). Sổ chi phí phân vùng `ai_cost_ledger` định nghĩa ở `ai-cost-ledger.log-table.ts`; trigger chặn
// sửa `model_prices`, khung nhìn hỗ trợ, dữ liệu khởi đầu viết tay ở migration 0029/0030.
//
// Tiền là `bigint` micro-USD (không số thực). Trạng thái ngân sách KHÔNG lưu cột riêng: suy ra từ used/reserved/cap/
// soft_limit khi đọc (chỉ lưu cờ mốc notified_80/notified_100). Khóa ngoại chỉ trong module hoặc tới bảng tài khoản
// (ADR-09); `industry_id` là mã tham chiếu, không FK.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { microUsd, moduleSchema, sharedTable, tenantTable } from '../../../../core/db';
import { uuidV7 } from '../../../../core/ids/uuid-v7';

const aiGateway = moduleSchema('ai_gateway');
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const dateOnly = (name: string) => date(name, { mode: 'string' });

export const RESERVATION_STATES = ['held', 'calling', 'settled', 'released'] as const;
export const LEDGER_ANOMALIES = ['over_estimate', 'unsettled', 'missing_usage'] as const;
const TASKS_SQL = `'post_generation','topic_suggestion','image_labeling','video_labeling','transcription','trend_summary'`;
const TIERS_SQL = `'default','cheap','cheap_vision','stt'`;
const STATES_SQL = RESERVATION_STATES.map((s) => `'${s}'`).join(',');

// ---------------------------------------------------------------------------------------------------------------
// Bảng tenant
// ---------------------------------------------------------------------------------------------------------------

/** Ngân sách AI: một dòng mỗi tài khoản mỗi chu kỳ (FR-002). `cap`/`soft_limit` chụp từ `ai_settings` lúc tạo. */
export const aiBudgets = tenantTable(
  aiGateway,
  'ai_budgets',
  {
    cycle_start: dateOnly('cycle_start').notNull(),
    cycle_end: dateOnly('cycle_end').notNull(),
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
    uniqueIndex('ai_budgets_account_cycle_key').on(t.account_id, t.cycle_start),
    index('ai_budgets_account_cycle_idx').on(t.account_id, sql`${t.cycle_start} DESC`),
    check(
      'ai_budgets_within_cap',
      sql`"used" >= 0 AND "reserved" >= 0 AND "used" + "reserved" <= "cap"`,
    ),
    check('ai_budgets_soft_below_cap', sql`"soft_limit" < "cap" AND "cap" > 0`),
    check('ai_budgets_cycle_order', sql`"cycle_end" > "cycle_start"`),
  ],
);

/** Giữ chỗ cho một lời gọi (FR-008). Chuyển trạng thái chỉ bằng UPDATE … WHERE state = :expected. */
export const aiReservations = tenantTable(
  aiGateway,
  'ai_reservations',
  {
    cycle_start: dateOnly('cycle_start').notNull(),
    task: text('task').notNull(),
    model_tier: text('model_tier').notNull(),
    provider: text('provider').notNull(),
    model_id: text('model_id').notNull(),
    /** Dòng `model_prices` đã dùng để ước tính (cùng module → có FK). */
    price_id: uuid('price_id')
      .notNull()
      .references(() => modelPrices.id, { onDelete: 'restrict' }),
    estimate: microUsd('estimate').notNull(),
    state: text('state').notNull().default('held'),
    request_id: text('request_id'),
    trace_id: text('trace_id'),
    reserved_at: timestamptz('reserved_at').notNull().defaultNow(),
    called_at: timestamptz('called_at'),
    closed_at: timestamptz('closed_at'),
  },
  (t) => [
    index('ai_reservations_account_state_idx').on(t.account_id, t.state, t.reserved_at),
    // Chống tạo lại cùng một lời gọi logic (FR-037a).
    uniqueIndex('ai_reservations_request_key')
      .on(t.account_id, t.cycle_start, t.request_id)
      .where(sql`"request_id" IS NOT NULL AND "state" <> 'released'`),
    check('ai_reservations_estimate_non_negative', sql`"estimate" >= 0`),
    check('ai_reservations_state_check', sql.raw(`"state" IN (${STATES_SQL})`)),
    check('ai_reservations_task_check', sql.raw(`"task" IN (${TASKS_SQL})`)),
    check('ai_reservations_tier_check', sql.raw(`"model_tier" IN (${TIERS_SQL})`)),
    check(
      'ai_reservations_request_id_length',
      sql`"request_id" IS NULL OR char_length("request_id") <= 128`,
    ),
  ],
);

/**
 * Phần chi phí xu hướng chia cho tài khoản cùng ngành (FR-033). Chỉ nhân viên đọc (khung nhìn hỗ trợ), KHÔNG cộng vào
 * `ai_budgets.used`. `industry_id`, `shared_ledger_id` là mã tham chiếu (không FK).
 */
export const aiTrendAllocations = tenantTable(
  aiGateway,
  'ai_trend_allocations',
  {
    week_start: dateOnly('week_start').notNull(),
    industry_id: uuid('industry_id').notNull(),
    cost_micro_usd: microUsd('cost_micro_usd').notNull(),
    shared_ledger_id: uuid('shared_ledger_id').notNull(),
  },
  (t) => [
    uniqueIndex('ai_trend_allocations_key').on(
      t.account_id,
      t.week_start,
      t.industry_id,
      t.shared_ledger_id,
    ),
    check('ai_trend_allocations_cost_non_negative', sql`"cost_micro_usd" >= 0`),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// Bảng dùng chung (chỉ vai trò `system` ghi)
// ---------------------------------------------------------------------------------------------------------------

/** Bảng giá mô hình, CHỈ THÊM (trigger chặn UPDATE/DELETE). Giá hiện hành = dòng `effective_from` lớn nhất ≤ now(). */
export const modelPrices = sharedTable(
  aiGateway,
  'model_prices',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidV7()),
    provider: text('provider').notNull(),
    model_id: text('model_id').notNull(),
    unit: text('unit').notNull(),
    input_per_mtok: microUsd('input_per_mtok'),
    output_per_mtok: microUsd('output_per_mtok'),
    cached_input_per_mtok: microUsd('cached_input_per_mtok'),
    per_minute: microUsd('per_minute'),
    billing_granularity_sec: integer('billing_granularity_sec').notNull().default(1),
    effective_from: timestamptz('effective_from').notNull(),
    created_by: text('created_by').notNull(),
    created_at: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('model_prices_lookup_idx').on(
      t.provider,
      t.model_id,
      t.unit,
      sql`${t.effective_from} DESC`,
    ),
    check('model_prices_unit_check', sql`"unit" IN ('token', 'audio_minute')`),
    check('model_prices_granularity_check', sql`"billing_granularity_sec" > 0`),
    check(
      'model_prices_positive_matches_unit',
      sql`(
        "unit" = 'token'
        AND "input_per_mtok" IS NOT NULL AND "input_per_mtok" > 0
        AND "output_per_mtok" IS NOT NULL AND "output_per_mtok" > 0
        AND ("cached_input_per_mtok" IS NULL OR "cached_input_per_mtok" > 0)
        AND "per_minute" IS NULL
      ) OR (
        "unit" = 'audio_minute'
        AND "per_minute" IS NOT NULL AND "per_minute" > 0
        AND "input_per_mtok" IS NULL AND "output_per_mtok" IS NULL AND "cached_input_per_mtok" IS NULL
      )`,
    ),
  ],
  {
    reason:
      'Bảng giá mô hình là cấu hình toàn hệ thống, không thuộc tài khoản nào (FR-019, FR-020).',
  },
);

/** Ngân sách hệ thống theo tuần (xu hướng dùng chung). `week_start` là thứ Hai 00:00 UTC+7. */
export const systemBudgets = sharedTable(
  aiGateway,
  'system_budgets',
  {
    week_start: dateOnly('week_start').primaryKey(),
    used: microUsd('used')
      .notNull()
      .default(sql`0`),
    reserved: microUsd('reserved')
      .notNull()
      .default(sql`0`),
    /** Chụp lúc tạo: industry_count × per_industry_micro_usd, hoặc trần cấu hình tạm (R-11). */
    cap: microUsd('cap').notNull(),
    industry_count: integer('industry_count'),
    per_industry_micro_usd: microUsd('per_industry_micro_usd'),
    created_at: timestamptz('created_at').notNull().defaultNow(),
    updated_at: timestamptz('updated_at').notNull().defaultNow(),
  },
  () => [
    check(
      'system_budgets_within_cap',
      sql`"used" >= 0 AND "reserved" >= 0 AND "used" + "reserved" <= "cap"`,
    ),
    check('system_budgets_cap_positive', sql`"cap" > 0`),
  ],
  {
    reason:
      'Ngân sách xu hướng theo tuần dùng chung cho mọi tài khoản cùng ngành, không thuộc tài khoản nào (FR-032).',
  },
);

/** Giữ chỗ của ngân sách hệ thống. */
export const systemReservations = sharedTable(
  aiGateway,
  'system_reservations',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidV7()),
    week_start: dateOnly('week_start')
      .notNull()
      .references(() => systemBudgets.week_start, { onDelete: 'restrict' }),
    industry_id: uuid('industry_id'),
    task: text('task').notNull(),
    model_tier: text('model_tier').notNull(),
    provider: text('provider').notNull(),
    model_id: text('model_id').notNull(),
    price_id: uuid('price_id')
      .notNull()
      .references(() => modelPrices.id, { onDelete: 'restrict' }),
    estimate: microUsd('estimate').notNull(),
    state: text('state').notNull().default('held'),
    request_id: text('request_id'),
    trace_id: text('trace_id'),
    reserved_at: timestamptz('reserved_at').notNull().defaultNow(),
    called_at: timestamptz('called_at'),
    closed_at: timestamptz('closed_at'),
  },
  (t) => [
    index('system_reservations_state_idx').on(t.state, t.reserved_at),
    uniqueIndex('system_reservations_request_key')
      .on(t.week_start, t.request_id)
      .where(sql`"request_id" IS NOT NULL AND "state" <> 'released'`),
    check('system_reservations_estimate_non_negative', sql`"estimate" >= 0`),
    check('system_reservations_state_check', sql.raw(`"state" IN (${STATES_SQL})`)),
  ],
  {
    reason:
      'Giữ chỗ của ngân sách hệ thống (xu hướng dùng chung), không thuộc tài khoản nào (FR-032).',
  },
);

/** Sổ chi phí hệ thống (không phân vùng ở giai đoạn 1: ~1 lời gọi/ngành/tuần). */
export const systemCostLedger = sharedTable(
  aiGateway,
  'system_cost_ledger',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidV7()),
    week_start: dateOnly('week_start').notNull(),
    industry_id: uuid('industry_id'),
    reservation_id: uuid('reservation_id').notNull(),
    request_id: text('request_id'),
    task: text('task').notNull(),
    model_tier: text('model_tier').notNull(),
    model_id: text('model_id').notNull(),
    provider: text('provider').notNull(),
    input_tokens: integer('input_tokens').notNull().default(0),
    output_tokens: integer('output_tokens').notNull().default(0),
    cached_input_tokens: integer('cached_input_tokens').notNull().default(0),
    audio_seconds: integer('audio_seconds'),
    cost_micro_usd: microUsd('cost_micro_usd').notNull(),
    estimate_micro_usd: microUsd('estimate_micro_usd').notNull(),
    anomaly: text('anomaly'),
    over_cap_micro_usd: microUsd('over_cap_micro_usd')
      .notNull()
      .default(sql`0`),
    trace_id: text('trace_id'),
    created_at: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('system_cost_ledger_week_idx').on(t.week_start, t.created_at),
    uniqueIndex('system_cost_ledger_reservation_key').on(t.reservation_id),
    check(
      'system_cost_ledger_anomaly_check',
      sql`"anomaly" IS NULL OR "anomaly" IN ('over_estimate', 'unsettled', 'missing_usage')`,
    ),
    check(
      'system_cost_ledger_cost_non_negative',
      sql`"cost_micro_usd" >= 0 AND "over_cap_micro_usd" >= 0`,
    ),
  ],
  {
    reason:
      'Sổ chi phí của ngân sách hệ thống (xu hướng dùng chung), không thuộc tài khoản nào (FR-032, FR-033).',
  },
);

/** Định tuyến mô hình theo bậc: rank 1 = chính, rank 2 = dự phòng (FR-024a). */
export const modelRoutes = sharedTable(
  aiGateway,
  'model_routes',
  {
    tier: text('tier').notNull(),
    rank: smallint('rank').notNull(),
    provider: text('provider').notNull(),
    model_id: text('model_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    updated_at: timestamptz('updated_at').notNull().defaultNow(),
    updated_by: text('updated_by').notNull(),
  },
  (t) => [
    primaryKey({ name: 'model_routes_pkey', columns: [t.tier, t.rank] }),
    check('model_routes_rank_check', sql`"rank" IN (1, 2)`),
    check('model_routes_tier_check', sql.raw(`"tier" IN (${TIERS_SQL})`)),
  ],
  {
    reason:
      'Cấu hình định tuyến mô hình toàn hệ thống, đổi bằng dữ liệu không cần phát hành (FR-024a).',
  },
);

/** Bật/tắt dự phòng theo loại việc (FR-024a). */
export const taskFallback = sharedTable(
  aiGateway,
  'task_fallback',
  {
    task: text('task').primaryKey(),
    enabled: boolean('enabled').notNull().default(false),
    updated_at: timestamptz('updated_at').notNull().defaultNow(),
    updated_by: text('updated_by').notNull(),
  },
  () => [check('task_fallback_task_check', sql.raw(`"task" IN (${TASKS_SQL})`))],
  { reason: 'Cấu hình dự phòng theo loại việc toàn hệ thống (FR-024a).' },
);

/** Cấu hình Cổng AI: đúng một dòng (id = 1) (FR-011, FR-019a, FR-032a). */
export const aiSettings = sharedTable(
  aiGateway,
  'ai_settings',
  {
    id: smallint('id').primaryKey(),
    account_cap_micro_usd: microUsd('account_cap_micro_usd').notNull(),
    account_soft_limit_micro_usd: microUsd('account_soft_limit_micro_usd').notNull(),
    per_industry_weekly_micro_usd: microUsd('per_industry_weekly_micro_usd').notNull(),
    updated_at: timestamptz('updated_at').notNull().defaultNow(),
    updated_by: text('updated_by').notNull(),
  },
  () => [
    check('ai_settings_single_row', sql`"id" = 1`),
    check(
      'ai_settings_limits',
      sql`"account_soft_limit_micro_usd" < "account_cap_micro_usd" AND "per_industry_weekly_micro_usd" > 0 AND "account_soft_limit_micro_usd" > 0`,
    ),
  ],
  { reason: 'Cấu hình trần/ngưỡng AI toàn hệ thống, một dòng duy nhất (FR-011, FR-019a).' },
);

/** Hóa đơn nhà cung cấp do vận hành nhập để đối soát (FR-034). */
export const providerInvoices = sharedTable(
  aiGateway,
  'provider_invoices',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidV7()),
    provider: text('provider').notNull(),
    invoice_date: dateOnly('invoice_date').notNull(),
    total_micro_usd: microUsd('total_micro_usd').notNull(),
    entered_by: text('entered_by').notNull(),
    entered_at: timestamptz('entered_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('provider_invoices_key').on(t.provider, t.invoice_date),
    check('provider_invoices_total_non_negative', sql`"total_micro_usd" >= 0`),
  ],
  {
    reason:
      'Dữ liệu đối soát hóa đơn nhà cung cấp theo toàn hệ thống, không thuộc tài khoản nào (FR-034).',
  },
);
