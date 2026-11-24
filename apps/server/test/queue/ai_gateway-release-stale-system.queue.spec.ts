// T062a (015 US7, FR-009/FR-010, hiến chương V): việc `ai_gateway.release_stale_system` (hàng chờ `scheduled`, phạm vi system, mỗi
// phút) của nhánh THẬT: (1) Worker driver `real` TỰ khai báo lịch mỗi phút – không dựa vào `FAKE_STATE_STORE=sandbox` hay lời
// gọi `defineStaleSystemSchedule` của kiểm thử; (2) giữ chỗ hệ thống treo > 15 phút được dọn (held → released, calling → quyết
// toán theo ước tính + sổ `unsettled`), chạy dọn hai lần như một lần; (3) ngân sách hệ thống không có việc hẹn theo giữ chỗ nên
// lịch là đường dọn duy nhất. Bản của sandbox 005: `ai-release-stale.queue.spec.ts`. Chạy `pnpm test:queue`.
import { Global, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { runWithJobContext } from '../../src/core/context/bind-account';
import { APP_CONFIG, type AppConfig } from '../../src/core';
import { loadConfig } from '../../src/core/config/load-config';
import { systemTx } from '../../src/core/db/transaction';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { ACCOUNT_PUBLIC_API } from '../../src/modules/account';
import { AI_DB_STORE, AiGatewayModule } from '../../src/modules/ai_gateway/ai_gateway.module';
import type { DbBudgetStore } from '../../src/modules/ai_gateway/internal/budget/db-budget-store';
import { weekStart } from '../../src/modules/ai_gateway/internal/budget/system-budget';
import { releaseStaleSystemJob, STALE_RESERVATION_MS } from '../../src/modules/ai_gateway/jobs';
import { NOTIFICATIONS } from '../../src/modules/notifications';
import { enqueue } from '../../src/modules/queue';
import { listSchedules } from '../../src/modules/queue/schedules';
import { DbBudgetControl } from '../contracts/ai/db-control';
import { TEST_AUTH_ENV } from '../helpers/auth-env';
import { logOccurrences } from '../ai_gateway/helpers/allocation-kit';
import { expectIdempotent, startTestProducer, startTestWorkers } from '../support/queue-test-kit';
import {
  asOwner,
  describeDb,
  dbUrls,
  jobs,
  makeDatabase,
  resetQueues,
  type TestDatabase,
} from './helpers/queue-db';

const SCHEDULE = 'ai_gateway.release_stale_system';
const META = { task: 'trend_summary' as const, modelTier: 'cheap' as const };

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

/** Module toàn cục cấp các cổng mà AiGatewayModule cần (cấu hình, thông báo, mốc chu kỳ tài khoản). */
function stubsFor(config: AppConfig) {
  @Global()
  @Module({
    providers: [
      { provide: APP_CONFIG, useValue: config },
      { provide: NOTIFICATIONS, useValue: { emit: () => Promise.resolve() } },
      { provide: ACCOUNT_PUBLIC_API, useValue: {} },
    ],
    exports: [APP_CONFIG, NOTIFICATIONS, ACCOUNT_PUBLIC_API],
  })
  class StubModule {}
  return StubModule;
}

const inSystem = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithJobContext({ traceId: uuidV7() }, fn);

describeDb('Việc ai_gateway.release_stale_system – nhánh thật (015 T062a)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let ref: TestingModule;
  let store: DbBudgetStore;
  let control: DbBudgetControl;
  const key = () => ({ scope: 'system' as const, weekStart: weekStart() });

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 6 });
    stopProducer = await startTestProducer();
    // FAKE_STATE_STORE đặt rõ là `memory`: lịch phải xuất hiện dù KHÔNG phải `sandbox`.
    const config = configFor({ FAKE_STATE_STORE: 'memory' });
    ref = await Test.createTestingModule({
      imports: [stubsFor(config), AiGatewayModule.forUnit('worker')],
    }).compile();
    const dbStore = ref.get<DbBudgetStore | null>(AI_DB_STORE);
    if (dbStore === null) throw new Error('AI_DB_STORE phải có ở driver real');
    store = dbStore;
    control = new DbBudgetControl(store);
  });
  afterAll(async () => {
    await ref.close();
    await stopProducer();
    await database.close();
  });
  beforeEach(async () => {
    await resetQueues();
    await asOwner(async (c) => {
      await c.query('DELETE FROM ai_gateway.system_cost_ledger');
      await c.query('DELETE FROM ai_gateway.system_reservations');
      await c.query('UPDATE ai_gateway.system_budgets SET used = 0, reserved = 0');
    });
  });

  async function seed() {
    return inSystem(async () => {
      const held = await store.reserve(key(), 1_000, META);
      const calling = await store.reserve(key(), 2_000, META);
      if (!held.ok || !calling.ok) throw new Error('giữ chỗ hệ thống phải thành công');
      await store.markCalling(calling.reservationId);
      await control.ageReservations(STALE_RESERVATION_MS + 60_000);
      const young = await store.reserve(key(), 7, META);
      if (!young.ok) throw new Error('giữ chỗ hệ thống phải thành công');
      return {
        held: held.reservationId,
        calling: calling.reservationId,
        young: young.reservationId,
      };
    });
  }

  const states = () =>
    inSystem(async () =>
      Object.fromEntries((await control.reservations()).map((r) => [r.id, r.state])),
    );
  const snapshot = () =>
    inSystem(async () => ({
      usage: await store.usage(key()),
      states: (await control.reservations()).map((r) => r.state).sort(),
      ledger: (await control.ledger()).length,
    }));

  it('Worker driver real tự khai báo đúng một lịch mỗi phút cho việc hệ thống này (không cần sandbox, không cần kiểm thử gọi hàm khai báo)', () => {
    const found = listSchedules().filter((s) => s.name === SCHEDULE);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ cron: '* * * * *', tz: 'UTC' });
    expect(found[0]!.jobType.name).toBe(SCHEDULE);
    expect(found[0]!.jobType.scope).toBe('system');
    expect(found[0]!.jobType.queue).toBe('scheduled');
  });

  it('giữ chỗ hệ thống KHÔNG hẹn việc theo giữ chỗ (việc tenant không chạy được ở ngữ cảnh hệ thống) → lịch là đường dọn duy nhất', async () => {
    await seed();
    expect(await jobs("data->>'type' = 'ai_gateway.release_stale'")).toEqual([]);
  });

  it('việc chạy: held quá 15 phút → released, calling → quyết toán theo ước tính (sổ unsettled), dưới 15 phút không đụng', async () => {
    const ids = await seed();
    const warnBefore = logOccurrences('ai.unsettled_reservation');
    await systemTx(() => enqueue(releaseStaleSystemJob, {}));
    const workers = await startTestWorkers(1, { queues: ['scheduled'] });
    try {
      await workers.drain();
    } finally {
      await workers.stop();
    }
    expect(await states()).toEqual({
      [ids.held]: 'released',
      [ids.calling]: 'settled',
      [ids.young]: 'held',
    });
    await inSystem(async () => {
      expect(await store.usage(key())).toMatchObject({ used: 2_000, reserved: 7 });
      const ledger = await control.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        anomaly: 'unsettled',
        costMicroUsd: 2_000,
        estimateMicroUsd: 2_000,
        overCapMicroUsd: 0,
        reservationId: ids.calling,
      });
    });
    expect(logOccurrences('ai.unsettled_reservation')).toBeGreaterThan(warnBefore);
  });

  it('chạy dọn hai lần như một lần: không cộng lại, không thêm dòng sổ, không đổi trạng thái (hiến chương V)', async () => {
    await seed();
    // Lần đầu dọn thật, sau đó mỗi lần chạy thêm phải cho đúng cùng ảnh chụp.
    await expectIdempotent(releaseStaleSystemJob, {}, { snapshot });
    const after = await snapshot();
    expect(after.states).toEqual(['held', 'released', 'settled']);
    expect(after.ledger).toBe(1);
    expect(after.usage).toMatchObject({ used: 2_000, reserved: 7 });
    await expectIdempotent(releaseStaleSystemJob, {}, { snapshot });
  });

  it('bất biến: used + reserved ≤ cap sau khi dọn, kể cả khi giữ chỗ calling treo bằng đúng phần còn lại của trần', async () => {
    await inSystem(async () => {
      const snap = await store.usage(key());
      const r = await store.reserve(key(), snap.cap - snap.used - snap.reserved, META);
      if (!r.ok) throw new Error('giữ chỗ bằng đúng phần còn lại phải thành công');
      await store.markCalling(r.reservationId);
      await control.ageReservations(STALE_RESERVATION_MS + 60_000);
    });
    await expectIdempotent(releaseStaleSystemJob, {}, { snapshot });
    const usage = (await snapshot()).usage;
    expect(usage.used + usage.reserved).toBeLessThanOrEqual(usage.cap);
    expect(usage.used).toBeGreaterThan(0); // calling quyết toán theo ước tính
    expect(usage.reserved).toBe(0);
  });
});
