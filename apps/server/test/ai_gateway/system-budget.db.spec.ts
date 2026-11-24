// T058 (015 US7, FR-032/FR-032a, R-11): ngân sách HỆ THỐNG theo tuần trên kho thật `DbBudgetStore` (bảng `system_budgets`).
// Trần tuần = số ngành đang có tài khoản hoạt động × mức/ngành, CHỤP lúc tạo dòng tuần; số ngành lấy từ cổng đảo ngược
// `ActiveIndustriesSource`; thiếu hiện thực → trần tạm `AI_SYSTEM_WEEKLY_CAP_MICRO_USD` + cảnh báo `ai.industry_source_missing`.
// Viết TRƯỚC mã (T060): thất bại cho tới khi kho thật đọc nguồn số ngành (tùy chọn `activeIndustries` của `DbBudgetStore`
// và nối `ACTIVE_INDUSTRIES_SOURCE` trong ai_gateway.module). Phần hợp đồng cấp Cổng (mục 20) ở test/contracts/ai.
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { APP_CONFIG, type AppConfig } from '../../src/core';
import { loadConfig } from '../../src/core/config/load-config';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { ACCOUNT_PUBLIC_API } from '../../src/modules/account';
import {
  ACTIVE_INDUSTRIES_SOURCE,
  type ActiveIndustriesSource,
} from '../../src/modules/ai_gateway';
import { AI_DB_STORE, AiGatewayModule } from '../../src/modules/ai_gateway/ai_gateway.module';
import type {
  BudgetStore,
  LedgerDraft,
} from '../../src/modules/ai_gateway/internal/budget/budget-store';
import type { DbBudgetStore } from '../../src/modules/ai_gateway/internal/budget/db-budget-store';
import { weekStart } from '../../src/modules/ai_gateway/internal/budget/system-budget';
import { AiSettings } from '../../src/modules/ai_gateway/internal/settings/ai-settings';
import { NOTIFICATIONS } from '../../src/modules/notifications';
import { makeDbStore } from '../contracts/ai/harness';
import { TEST_AUTH_ENV } from '../helpers/auth-env';
import {
  asOwner,
  createAccount,
  dbUrls,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from '../db/helpers/db';
import { logOccurrences } from './helpers/allocation-kit';

const PER = 100_000; // mức/ngành dùng trong ca kiểm thử (micro-USD)
const META = { task: 'trend_summary' as const, modelTier: 'cheap' as const };
const LEDGER: LedgerDraft = {
  task: 'trend_summary',
  modelTier: 'cheap',
  modelId: 'qa-model',
  provider: 'qa-provider',
  inputTokens: 10,
  outputTokens: 20,
  cachedInputTokens: 0,
  traceId: null,
  industryId: '01900000-0000-7000-8000-0000000000a1',
};

/** Tuần thứ `i` tính từ đầu 2040 (thứ Hai 00:00 UTC+7) – cách xa dữ liệu của các ca khác. */
const week = (i: number): string => weekStart(new Date(Date.UTC(2040, 0, 4 + 7 * i, 5)));
const key = (w: string) => ({ scope: 'system' as const, weekStart: w });
const inSystem = <T>(fn: () => Promise<T>): Promise<T> => withAccount(undefined, fn);

const settingsWith = (perIndustryWeekly: number): AiSettings =>
  new AiSettings({
    ttlMs: 0,
    load: () => Promise.resolve({ accountCap: 4_000_000, softLimit: 2_000_000, perIndustryWeekly }),
  });

/** Nguồn số ngành đếm số lần được hỏi. */
function industriesSource(count: number): { source: ActiveIndustriesSource; asked: () => number } {
  let n = 0;
  return {
    asked: () => n,
    source: {
      countActiveIndustries: () => {
        n += 1;
        return Promise.resolve(count);
      },
    },
  };
}

/** Kho thật với tùy chọn của US7 (`activeIndustries` chưa có trong kiểu hiện tại → ép kiểu, T060 bổ sung). */
const storeWith = (opts: Record<string, unknown>): Promise<BudgetStore> => makeDbStore(opts);

interface SystemRow {
  cap: number;
  used: number;
  reserved: number;
  industry_count: number | null;
  per_industry_micro_usd: number | null;
}
async function rowOf(w: string): Promise<SystemRow | undefined> {
  return asOwner(async (c) => {
    const r = await c.query<Record<string, string | null>>(
      `SELECT cap::text, used::text, reserved::text, industry_count::text, per_industry_micro_usd::text
         FROM ai_gateway.system_budgets WHERE week_start = $1::date`,
      [w],
    );
    const x = r.rows[0];
    if (x === undefined) return undefined;
    return {
      cap: Number(x.cap),
      used: Number(x.used),
      reserved: Number(x.reserved),
      industry_count: x.industry_count === null ? null : Number(x.industry_count),
      per_industry_micro_usd:
        x.per_industry_micro_usd === null ? null : Number(x.per_industry_micro_usd),
    };
  });
}

async function dropWeeks(): Promise<void> {
  await asOwner(async (c) => {
    const range = ['2039-12-01', '2045-01-01'];
    await c.query(
      'DELETE FROM ai_gateway.system_cost_ledger WHERE week_start BETWEEN $1 AND $2',
      range,
    );
    await c.query(
      'DELETE FROM ai_gateway.system_reservations WHERE week_start BETWEEN $1 AND $2',
      range,
    );
    await c.query(
      'DELETE FROM ai_gateway.system_budgets WHERE week_start BETWEEN $1 AND $2',
      range,
    );
  });
}

describeDb('Ngân sách hệ thống theo ngành – kho thật (015 US7)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 12 });
    await dropWeeks();
  });
  afterAll(async () => {
    await dropWeeks();
    await database.close();
  });

  it.each([1, 2, 7])(
    'trần tuần = %i ngành × mức/ngành; chụp cả số ngành lẫn mức vào dòng tuần',
    async (n) => {
      const w = week(10 + n);
      const store = await storeWith({
        settings: settingsWith(PER),
        activeIndustries: industriesSource(n).source,
      });
      const r = await inSystem(() => store.reserve(key(w), 1_000, META));
      expect(r.ok).toBe(true);
      expect(r.snapshot.cap).toBe(n * PER);
      expect(await rowOf(w)).toMatchObject({
        cap: n * PER,
        industry_count: n,
        per_industry_micro_usd: PER,
        reserved: 1_000,
        used: 0,
      });
    },
  );

  it('mức/ngành lấy từ cấu hình ai_settings (không hằng số trong mã): đổi mức → trần tuần mới đổi theo', async () => {
    const seeded = await new AiSettings({ ttlMs: 0 }).get();
    const store = await storeWith({
      settings: new AiSettings({ ttlMs: 0 }),
      activeIndustries: industriesSource(3).source,
    });
    const w = week(20);
    await inSystem(() => store.reserve(key(w), 1, META));
    expect(await rowOf(w)).toMatchObject({
      cap: 3 * seeded.perIndustryWeekly,
      per_industry_micro_usd: seeded.perIndustryWeekly,
    });
  });

  it('cap CHỤP lúc tạo: đổi số ngành/mức sau đó không đổi trần của tuần đang chạy; tuần mới dùng số mới', async () => {
    const [w1, w2] = [week(30), week(31)];
    const first = await storeWith({
      settings: settingsWith(PER),
      activeIndustries: industriesSource(3).source,
    });
    await inSystem(() => first.reserve(key(w1), 1_000, META));
    expect((await rowOf(w1))!.cap).toBe(3 * PER);

    const changed = await storeWith({
      settings: settingsWith(2 * PER),
      activeIndustries: industriesSource(5).source,
    });
    const again = await inSystem(() => changed.reserve(key(w1), 1_000, META));
    expect(again.snapshot.cap).toBe(3 * PER);
    expect(await rowOf(w1)).toMatchObject({ cap: 3 * PER, industry_count: 3, reserved: 2_000 });

    await inSystem(() => changed.reserve(key(w2), 1_000, META));
    expect(await rowOf(w2)).toMatchObject({
      cap: 5 * 2 * PER,
      industry_count: 5,
      per_industry_micro_usd: 2 * PER,
    });
  });

  it('số ngành chỉ được hỏi khi tạo dòng tuần (một lần), không hỏi lại ở mỗi lần giữ chỗ', async () => {
    const src = industriesSource(2);
    const store = await storeWith({ settings: settingsWith(PER), activeIndustries: src.source });
    const w = week(40);
    for (let i = 0; i < 4; i++) await inSystem(() => store.reserve(key(w), 100, META));
    expect(src.asked()).toBe(1);
    expect((await rowOf(w))!.reserved).toBe(400);
  });

  it('thiếu hiện thực nguồn số ngành → trần tạm AI_SYSTEM_WEEKLY_CAP_MICRO_USD + cảnh báo ai.industry_source_missing', async () => {
    const store = await storeWith({ settings: settingsWith(PER), systemWeeklyCap: 777_000 });
    const w = week(50);
    const before = logOccurrences('ai.industry_source_missing');
    const r = await inSystem(() => store.reserve(key(w), 1_000, META));
    expect(r.ok).toBe(true);
    expect(r.snapshot.cap).toBe(777_000);
    expect(await rowOf(w)).toMatchObject({
      cap: 777_000,
      industry_count: null,
      per_industry_micro_usd: null,
    });
    expect(logOccurrences('ai.industry_source_missing')).toBeGreaterThan(before);
  });

  it('hết trần: giữ chỗ vừa đúng phần còn lại thành công, thêm 1 micro-USD bị chặn (ok=false), trả lại giữ chỗ thì giữ được tiếp', async () => {
    const store = await storeWith({
      settings: settingsWith(PER),
      activeIndustries: industriesSource(2).source,
    });
    const w = week(60);
    const cap = 2 * PER;
    const full = await inSystem(() => store.reserve(key(w), cap, META));
    if (!full.ok) throw new Error('giữ chỗ bằng đúng trần phải thành công');
    const over = await inSystem(() => store.reserve(key(w), 1, META));
    expect(over.ok).toBe(false);
    expect(over.snapshot).toMatchObject({ cap, used: 0, reserved: cap });
    expect(await rowOf(w)).toMatchObject({ reserved: cap }); // lượt bị chặn không để lại dấu vết

    await inSystem(() => store.release(full.reservationId));
    const again = await inSystem(() => store.reserve(key(w), 1, META));
    expect(again.ok).toBe(true);
  });

  it('đồng thời: 12 lần giữ chỗ 30 000 trên trần 200 000 → đúng 6 thành công, reserved ≤ cap ở mọi lúc', async () => {
    const store = await storeWith({
      settings: settingsWith(PER),
      activeIndustries: industriesSource(2).source,
    });
    const w = week(70);
    await inSystem(() => store.reserve(key(w), 0, META)); // tạo dòng tuần trước để so trần
    const results = await Promise.all(
      Array.from({ length: 12 }, () => inSystem(() => store.reserve(key(w), 30_000, META))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(6);
    const row = (await rowOf(w))!;
    expect(row.reserved).toBe(180_000);
    expect(row.used + row.reserved).toBeLessThanOrEqual(row.cap);
  });

  it('ngân sách hệ thống không chạm ngân sách khách: giữ chỗ + quyết toán hệ thống không đổi ai_budgets của bất kỳ tài khoản nào', async () => {
    const account = await createAccount();
    await asOwner((c) =>
      c.query(
        `INSERT INTO ai_gateway.ai_budgets (id, account_id, cycle_start, cycle_end, used, reserved, cap, soft_limit)
         VALUES ($1, $2, '2040-01-01', '2040-02-01', 4242, 17, 4000000, 2000000)`,
        [uuidV7(), account],
      ),
    );
    const snap = () =>
      asOwner(
        async (c) =>
          (
            await c.query<Record<string, string | boolean>>(
              `SELECT account_id::text, used::text, reserved::text, cap::text, notified_80, notified_100
               FROM ai_gateway.ai_budgets ORDER BY account_id, cycle_start`,
            )
          ).rows,
      );
    const before = await snap();
    const store = await storeWith({
      settings: settingsWith(PER),
      activeIndustries: industriesSource(2).source,
    });
    const w = week(80);
    const r = await inSystem(() =>
      store.reserve(key(w), 5_000, { ...META, industryId: LEDGER.industryId }),
    );
    if (!r.ok) throw new Error('giữ chỗ hệ thống phải thành công');
    await inSystem(() => store.markCalling(r.reservationId));
    await inSystem(() => store.settle(r.reservationId, 3_000, LEDGER));
    expect(await snap()).toEqual(before);
    expect(await rowOf(w)).toMatchObject({ used: 3_000, reserved: 0 });
    const ledger = await asOwner((c) =>
      c.query(
        'SELECT industry_id::text, cost_micro_usd::text FROM ai_gateway.system_cost_ledger WHERE week_start = $1::date',
        [w],
      ),
    );
    expect(ledger.rows).toEqual([{ industry_id: LEDGER.industryId, cost_micro_usd: '3000' }]);
  });
});

// ------------------------------------------------------------------------------------------------------------
// Nối dây ở module Cổng AI (driver real): token ACTIVE_INDUSTRIES_SOURCE do module khác cung cấp (T063) được `AI_DB_STORE` dùng.
// ------------------------------------------------------------------------------------------------------------

function configFor(extra: Record<string, string>): AppConfig {
  return loadConfig({
    APP_ENV: 'test',
    LOG_LEVEL: 'error',
    ...TEST_AUTH_ENV,
    DATABASE_APP_URL: dbUrls.app,
    DATABASE_SUPPORT_URL: dbUrls.support,
    DATABASE_SYSTEM_URL: dbUrls.system,
    AI_GATEWAY_DRIVER: 'real',
    ANTHROPIC_API_KEY: 'sk-ant-KEYCANARY-aaaaaaaaaaaaaaaa',
    OPENAI_API_KEY: 'sk-oai-KEYCANARY-bbbbbbbbbbbbbbbb',
    ...extra,
  });
}

async function buildWith(
  extra: Record<string, string>,
  source: ActiveIndustriesSource | undefined,
) {
  const config = configFor(extra);
  @Global()
  @Module({
    providers: [
      { provide: APP_CONFIG, useValue: config },
      { provide: NOTIFICATIONS, useValue: { emit: () => Promise.resolve() } },
      { provide: ACCOUNT_PUBLIC_API, useValue: {} },
      ...(source !== undefined ? [{ provide: ACTIVE_INDUSTRIES_SOURCE, useValue: source }] : []),
    ],
    exports: [
      APP_CONFIG,
      NOTIFICATIONS,
      ACCOUNT_PUBLIC_API,
      ...(source !== undefined ? [ACTIVE_INDUSTRIES_SOURCE] : []),
    ],
  })
  class StubModule {}
  return Test.createTestingModule({
    imports: [StubModule, AiGatewayModule.forUnit('api')],
  }).compile();
}

describeDb('Ngân sách hệ thống – nối dây module Cổng AI (driver real, 015 US7)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 4 });
    await dropWeeks();
  });
  afterAll(async () => {
    await dropWeeks();
    await database.close();
  });

  it('module khác cung cấp ACTIVE_INDUSTRIES_SOURCE → trần tuần của kho do module dựng = số ngành × mức/ngành trong ai_settings', async () => {
    const seeded = await new AiSettings({ ttlMs: 0 }).get();
    const src = industriesSource(4);
    const ref = await buildWith({}, src.source);
    try {
      const store = ref.get<DbBudgetStore | null>(AI_DB_STORE)!;
      const w = week(90);
      const r = await inSystem(() => store.reserve(key(w), 1_000, META));
      expect(r.ok).toBe(true);
      expect(await rowOf(w)).toMatchObject({
        cap: 4 * seeded.perIndustryWeekly,
        industry_count: 4,
        per_industry_micro_usd: seeded.perIndustryWeekly,
      });
      expect(src.asked()).toBe(1);
    } finally {
      await ref.close();
    }
  });

  it('không module nào cung cấp nguồn → dùng AI_SYSTEM_WEEKLY_CAP_MICRO_USD của cấu hình + cảnh báo ai.industry_source_missing', async () => {
    const ref = await buildWith({ AI_SYSTEM_WEEKLY_CAP_MICRO_USD: '555000' }, undefined);
    try {
      const store = ref.get<DbBudgetStore | null>(AI_DB_STORE)!;
      const w = week(91);
      const before = logOccurrences('ai.industry_source_missing');
      const r = await inSystem(() => store.reserve(key(w), 1_000, META));
      expect(r.ok).toBe(true);
      expect(await rowOf(w)).toMatchObject({ cap: 555_000, industry_count: null });
      expect(logOccurrences('ai.industry_source_missing')).toBeGreaterThan(before);
    } finally {
      await ref.close();
    }
  });
});
