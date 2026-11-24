import { afterAll, beforeAll, expect, it } from 'vitest';
import { currentAccountId } from '../../src/core/db/transaction';
import { AiError, type AiRequest } from '../../src/modules/ai_gateway';
import { makeOnCrossed } from '../../src/modules/ai_gateway/ai_gateway.module';
import { DbPriceSource } from '../../src/modules/ai_gateway/internal/prices/db-price-source';
import {
  RouteBook,
  type RouteData,
} from '../../src/modules/ai_gateway/internal/routing/route-book';
import { QueueEmitter } from '../../src/modules/notifications/internal/emit';
import { createAccount, describeDb, makeDatabase, type TestDatabase } from '../db/helpers/db';
import { makeAiHarness, type AiHarness } from '../contracts/ai/harness';
import { jobs } from '../queue/helpers/queue-db';
import { startTestProducer } from '../support/queue-test-kit';
import { insertPrice, reservationRows, uniqueModel } from './helpers/price-fixtures';

// 015 US4 (T044): cổng ở driver có kho thật PHẢI theo `RouteBook.attemptsFor` – rank 2 chỉ khi tuyến `enabled` VÀ
// `task_fallback[task].enabled`. Ở đây dùng `RouteBook` THẬT (thuật toán `selectAttempts`) với dữ liệu tuyến tiêm vào,
// khác `stubRoutes` của mục 17 (danh sách lượt cố định). Bản giả của 005 vẫn luôn thử [primary, fallback]; test này khóa
// hành vi mới. ĐỎ TẠM tới T048 (gateway.service.ts còn lặp cứng 2 nhà cung cấp, kho còn lùi về tuyến chính khi thiếu rank 2).
// Chạy `pnpm test:db`.

const HOUR = 3_600_000;
const req = (task: AiRequest['task'] = 'post_generation'): AiRequest => ({
  task,
  prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'FB_CANARY Viết bài khai trương.' },
  maxOutputTokens: 100,
});

describeDb('Cổng AI – dự phòng theo attemptsFor (US4)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let h: AiHarness;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    stopProducer = await startTestProducer();
    h = await makeAiHarness('db', () => createAccount(), {
      onCrossed: makeOnCrossed(new QueueEmitter()),
      count: async (type) =>
        (
          await jobs(
            "data->>'type' = 'notifications.deliver' AND data->>'accountId' = $1 AND data->'payload'->'event'->>'type' = $2",
            [currentAccountId(), type],
          )
        ).length,
    });
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  /** Tuyến `default` có cả rank 1 và rank 2 đều `enabled`; `fallbackOn` quyết định cờ theo loại việc. */
  async function gatewayFor(task: AiRequest['task'], fallbackOn: boolean) {
    const a = uniqueModel();
    const b = uniqueModel();
    for (const m of [a, b]) {
      await insertPrice(m, { effectiveFrom: new Date(Date.now() - HOUR) });
    }
    const data: RouteData = {
      routes: [
        { tier: 'default', rank: 1, provider: a.provider, modelId: a.modelId, enabled: true },
        { tier: 'default', rank: 2, provider: b.provider, modelId: b.modelId, enabled: true },
      ],
      fallbackEnabled: new Map([[task, fallbackOn]]),
    };
    const gw = await h.db!.gatewayWith(
      {
        routes: new RouteBook({ ttlMs: 0, load: () => Promise.resolve(data) }),
        prices: new DbPriceSource({ ttlMs: 0 }),
      },
      { providerTimeoutMs: 5_000 },
    );
    return { gw, a, b };
  }

  const calls = () => ({
    primary: h.bundle.primary.calls.length,
    fallback: h.bundle.fallback.calls.length,
  });

  it('task_fallback[task].enabled = false: chính lỗi → AI_PROVIDER_UNAVAILABLE ngay, 0 lời gọi dự phòng, chỉ 1 dòng giữ chỗ', async () => {
    const { gw } = await gatewayFor('post_generation', false);
    const id = await createAccount();
    await h.inAccount(id, async () => {
      const before = calls();
      await h.fake.script([{ fail: 'error' }], 'primary');
      const err = await gw.generate(req()).catch((e: unknown) => e as AiError);
      expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
      expect(calls().primary - before.primary).toBe(1);
      expect(calls().fallback - before.fallback).toBe(0);
      expect((await reservationRows(id)).map((r) => r.state)).toEqual(['released']);
      expect(await h.fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
    });
  });

  it('task_fallback[task].enabled = true: chính lỗi → dự phòng đúng 1 lần theo tuyến rank 2, sổ ghi nhà cung cấp rank 2', async () => {
    const { gw, b } = await gatewayFor('post_generation', true);
    const id = await createAccount();
    await h.inAccount(id, async () => {
      const before = calls();
      await h.fake.script([{ fail: 'error' }], 'primary');
      await gw.generate(req());
      expect(calls().primary - before.primary).toBe(1);
      expect(calls().fallback - before.fallback).toBe(1);
      expect((await reservationRows(id)).map((r) => [r.state, r.provider])).toEqual([
        ['released', expect.any(String)],
        ['settled', b.provider],
      ]);
      expect((await h.fake.ledger()).map((l) => l.provider)).toEqual([b.provider]);
    });
  });

  it('dự phòng bật nhưng KHÔNG gọi lại lượt thứ ba: cả hai lỗi → đúng 2 lời gọi, 2 dòng released', async () => {
    const { gw } = await gatewayFor('post_generation', true);
    const id = await createAccount();
    await h.inAccount(id, async () => {
      const before = calls();
      await h.fake.script([{ fail: 'error' }, { fail: 'error' }], 'primary');
      await h.fake.script([{ fail: 'error' }, { fail: 'error' }], 'fallback');
      const err = await gw.generate(req()).catch((e: unknown) => e as AiError);
      expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
      expect(calls().primary - before.primary).toBe(1);
      expect(calls().fallback - before.fallback).toBe(1);
      expect((await reservationRows(id)).map((r) => r.state)).toEqual(['released', 'released']);
    });
  });
});
