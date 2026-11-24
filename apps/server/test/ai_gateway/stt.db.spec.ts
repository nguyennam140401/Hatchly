import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiError } from '../../src/modules/ai_gateway';
import { AiGatewayService } from '../../src/modules/ai_gateway/internal/gateway.service';
import { DbPriceSource } from '../../src/modules/ai_gateway/internal/prices/db-price-source';
import type {
  AiProviderAdapter,
  ProviderResult,
} from '../../src/modules/ai_gateway/internal/providers/provider';
import { ProviderCallError } from '../../src/modules/ai_gateway/internal/providers/provider-error';
import { makeAiHarness, type AiHarness } from '../contracts/ai/harness';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  type TestDatabase,
} from '../db/helpers/db';
import { startTestProducer } from '../support/queue-test-kit';
import { insertPrice, reservationRows, stubRoutes, uniqueModel } from './helpers/price-fixtures';
import { StubAdapter } from './helpers/stub-adapter';

// 015 US5 (T051, T053; FR-021, SC-009) trên kho THẬT `DbBudgetStore`, nhà cung cấp STT giả viết tay.
// Đỏ tạm tới khi T052 (estimate.ts + gateway.service.ts `transcribe`): hiện cổng quyết toán theo ƯỚC TÍNH, bỏ qua
// `audioSeconds` của nhà cung cấp, không làm tròn theo `billing_granularity_sec`, không ghi `anomaly='missing_usage'`.
// Quy ước đã chốt: chỉ 5 phút đầu (300 s); ước tính và quyết toán đều làm tròn LÊN theo `billing_granularity_sec`
// (để chi phí thực luôn ≤ ước tính, SC-009).

const HOUR = 3_600_000;
const PER_MIN = 6_000; // micro-USD / phút
const costOf = (sec: number, gran: number, perMin = PER_MIN): number => {
  const billed = Math.min(300, Math.ceil(sec / gran) * gran);
  return Math.ceil((billed * perMin) / 60);
};

/** Nhà cung cấp STT giả: đếm lời gọi, kết quả/lỗi do ca kiểm thử đặt. */
class SttAdapter extends StubAdapter {
  transcribeCalls = 0;
  onTranscribe: () => Promise<ProviderResult> = () =>
    Promise.resolve({
      text: 'xin chào',
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      modelId: 'stt-model',
    });
  override transcribe(): Promise<ProviderResult> {
    this.transcribeCalls++;
    return this.onTranscribe();
  }
}

describeDb('Cổng AI – chuyển giọng nói theo phút (US5, kho thật)', () => {
  let database: TestDatabase;
  let h: AiHarness;
  let stopProducer: () => Promise<void>;
  // Mỗi ca tự đặt mô hình STT + giá riêng (bảng giá chỉ-thêm, dùng chung giữa các ca).
  let current = uniqueModel('stt');
  const gw = { routes: stubRoutes(current) };

  async function useModel(tag: string, gran: number, perMin = PER_MIN): Promise<void> {
    const m = uniqueModel(`stt-${tag}`);
    await insertPrice(m, {
      unit: 'audio_minute',
      perMinute: perMin,
      granularitySec: gran,
      effectiveFrom: new Date(Date.now() - HOUR),
    });
    current = m;
    gw.routes = stubRoutes(m);
  }

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    stopProducer = await startTestProducer();
    h = await makeAiHarness(
      'db',
      () => createAccount(),
      { onCrossed: () => Promise.resolve(), count: () => Promise.resolve(0) },
      {
        // Tuyến đọc qua `gw.routes` để mỗi ca đổi mô hình/giá riêng mà không dựng lại harness.
        routes: { attemptsFor: (task, tier) => gw.routes.attemptsFor(task, tier) },
        prices: new DbPriceSource({ ttlMs: 0 }),
      },
    );
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  function rig(): { stt: SttAdapter; svc: AiGatewayService } {
    const stt = new SttAdapter(current.provider);
    const adapterFor = (): AiProviderAdapter => stt;
    const svc = new AiGatewayService({
      store: h.bundle.store,
      primary: stt,
      fallback: stt,
      adapterFor,
      providerTimeoutMs: 3_000,
      firstTokenTimeoutMs: 3_000,
    });
    return { stt, svc };
  }

  const inFreshAccount = async <T>(fn: (id: string) => Promise<T>): Promise<T> => {
    const id = await createAccount();
    return h.inAccount(id, () => fn(id));
  };

  const run = (svc: AiGatewayService, durationSec: number, requestId?: string) =>
    svc.transcribe({
      audioUrl: 'https://tenants.example/a.mp3',
      durationSec,
      language: 'vi',
      ...(requestId !== undefined ? { requestId } : {}),
    });

  async function ledgerAudioSeconds(accountId: string): Promise<(number | null)[]> {
    return asOwner(async (c) =>
      (
        await c.query<{ audio_seconds: number | null }>(
          'SELECT audio_seconds FROM ai_gateway.ai_cost_ledger WHERE account_id = $1 ORDER BY created_at, id',
          [accountId],
        )
      ).rows.map((r) => r.audio_seconds),
    );
  }

  describe('ước tính theo min(thời lượng, 300) và đơn vị audio_minute', () => {
    for (const gran of [1, 60]) {
      for (const dur of [90, 300, 720]) {
        it(`${dur} s, độ chi tiết ${gran} s → ước tính ${costOf(dur, gran)}, giá đơn vị audio_minute, chỉ 5 phút đầu`, async () => {
          await useModel(`e${dur}-${gran}`, gran);
          await inFreshAccount(async (id) => {
            const { stt, svc } = rig();
            // Nhà cung cấp báo đúng số giây đã xử lý (≤ 300).
            const processed = Math.min(dur, 300);
            stt.onTranscribe = () =>
              Promise.resolve({
                text: 'x',
                inputTokens: 0,
                outputTokens: 0,
                cachedInputTokens: 0,
                modelId: current.modelId,
                audioSeconds: processed,
              });
            await run(svc, dur);
            expect(stt.transcribeCalls).toBe(1);
            const rows = await reservationRows(id);
            expect(rows).toHaveLength(1);
            expect(Number(rows[0]!.estimate)).toBe(costOf(dur, gran));
            expect(rows[0]!.state).toBe('settled');
            const unit = await asOwner(
              async (c) =>
                (
                  await c.query<{ unit: string }>(
                    'SELECT unit FROM ai_gateway.model_prices WHERE id = $1',
                    [rows[0]!.price_id],
                  )
                ).rows[0]!.unit,
            );
            expect(unit).toBe('audio_minute');
            const [entry, ...rest] = await h.fake.ledger();
            expect(rest).toEqual([]);
            expect(entry!.estimateMicroUsd).toBe(costOf(dur, gran));
            expect(entry!.costMicroUsd).toBe(costOf(processed, gran));
            expect(entry!.costMicroUsd).toBeLessThanOrEqual(entry!.estimateMicroUsd);
            expect(entry!.anomaly).toBeNull();
            expect(await ledgerAudioSeconds(id)).toEqual([processed]);
            expect(await h.fake.getBudget()).toMatchObject({
              used: costOf(processed, gran),
              reserved: 0,
            });
          });
        });
      }
    }

    it('đơn giá lẻ: làm tròn LÊN micro-USD (90 s × 7001/phút = 10502), chi phí thực ≤ ước tính', async () => {
      await useModel('odd', 1, 7_001);
      await inFreshAccount(async () => {
        const { stt, svc } = rig();
        stt.onTranscribe = () =>
          Promise.resolve({
            text: 'x',
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            modelId: current.modelId,
            audioSeconds: 89,
          });
        await run(svc, 90);
        const [entry] = await h.fake.ledger();
        expect(entry!.estimateMicroUsd).toBe(10_502);
        expect(entry!.costMicroUsd).toBe(Math.ceil((89 * 7_001) / 60));
        expect(entry!.costMicroUsd).toBeLessThanOrEqual(entry!.estimateMicroUsd);
      });
    });
  });

  describe('quyết toán theo audioSeconds thực + độ chi tiết tính tiền', () => {
    it('độ chi tiết 60 s: nhà cung cấp báo 61 s → tính 120 s; báo 1 s → tính 60 s (làm tròn LÊN)', async () => {
      await useModel('g60', 60);
      for (const [reported, billed] of [
        [61, 120],
        [1, 60],
      ] as const) {
        await inFreshAccount(async () => {
          const { stt, svc } = rig();
          stt.onTranscribe = () =>
            Promise.resolve({
              text: 'x',
              inputTokens: 0,
              outputTokens: 0,
              cachedInputTokens: 0,
              modelId: current.modelId,
              audioSeconds: reported,
            });
          await run(svc, 600);
          const [entry] = await h.fake.ledger();
          expect(entry!.costMicroUsd).toBe((billed * PER_MIN) / 60);
        });
      }
    });

    it('nhà cung cấp báo > 300 s → ghi thời lượng THỰC (725), anomaly = over_estimate, chi phí kẹp theo trần (không còn ≤ ước tính)', async () => {
      await useModel('clamp', 1);
      await inFreshAccount(async (id) => {
        const { stt, svc } = rig();
        stt.onTranscribe = () =>
          Promise.resolve({
            text: 'x',
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            modelId: current.modelId,
            audioSeconds: 725,
          });
        await run(svc, 720);
        const [entry] = await h.fake.ledger();
        expect(entry!.estimateMicroUsd).toBe(costOf(300, 1));
        expect(await ledgerAudioSeconds(id)).toEqual([725]);
        expect(entry!.anomaly).toBe('over_estimate');
        // Chi phí thực tính trên 725 s (không kẹp 300); kho chỉ kẹp theo trần còn lại, không vượt trần.
        const actual = Math.ceil((725 * PER_MIN) / 60);
        expect(entry!.costMicroUsd).toBeGreaterThan(entry!.estimateMicroUsd);
        expect(entry!.costMicroUsd).toBeLessThanOrEqual(actual);
        expect(h.logText()).toContain('ai.cost_anomaly');
      });
    });

    it('durationSec = 0, âm, NaN, Infinity → AI_INVALID_REQUEST, không giữ chỗ, không gọi nhà cung cấp', async () => {
      await useModel('badDur', 1);
      for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await inFreshAccount(async (id) => {
          const { stt, svc } = rig();
          const err = await run(svc, bad).catch((e: unknown) => e);
          expect(err).toBeInstanceOf(AiError);
          expect((err as AiError).code).toBe('AI_INVALID_REQUEST');
          expect(stt.transcribeCalls).toBe(0);
          expect(await reservationRows(id)).toHaveLength(0);
          expect(await h.fake.ledger()).toEqual([]);
        });
      }
    });

    it('thiếu audioSeconds → quyết toán theo ƯỚC TÍNH, anomaly = missing_usage, có cảnh báo ai.cost_anomaly', async () => {
      await useModel('missing', 1);
      await inFreshAccount(async (id) => {
        const { stt, svc } = rig(); // onTranscribe mặc định: không có audioSeconds
        await run(svc, 90);
        const [entry, ...rest] = await h.fake.ledger();
        expect(rest).toEqual([]);
        expect(entry!.costMicroUsd).toBe(costOf(90, 1));
        expect(entry!.estimateMicroUsd).toBe(costOf(90, 1));
        expect(entry!.anomaly).toBe('missing_usage');
        expect(await ledgerAudioSeconds(id)).toEqual([null]);
        expect(await h.fake.getBudget()).toMatchObject({ used: costOf(90, 1), reserved: 0 });
        expect(h.logText()).toContain('ai.cost_anomaly');
        expect(stt.transcribeCalls).toBe(1);
      });
    });
  });

  describe('không có giọng nói / không đọc được → không phí cho phần không chạy', () => {
    it('lỗi bad_request/unsupported của nhà cung cấp → giữ chỗ released, không dòng sổ, used = reserved = 0', async () => {
      await useModel('fail', 1);
      await inFreshAccount(async (id) => {
        const { stt, svc } = rig();
        stt.onTranscribe = () =>
          Promise.reject(new ProviderCallError(current.provider, 'bad_request', 400));
        const err = await run(svc, 120).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AiError);
        expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
        expect((await reservationRows(id)).every((r) => r.state === 'released')).toBe(true);
        expect(await h.fake.ledger()).toEqual([]);
        expect(await h.fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
      });
    });

    it('audioSeconds = 0 (không có giọng nói) → chi phí 0, đúng một dòng sổ, không dôi ra ước tính', async () => {
      await useModel('zero', 1);
      await inFreshAccount(async () => {
        const { stt, svc } = rig();
        stt.onTranscribe = () =>
          Promise.resolve({
            text: '',
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            modelId: current.modelId,
            audioSeconds: 0,
          });
        await run(svc, 120);
        const [entry, ...rest] = await h.fake.ledger();
        expect(rest).toEqual([]);
        expect(entry!.costMicroUsd).toBe(0);
        expect(entry!.anomaly).toBeNull();
        expect(await h.fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
      });
    });

    it('ngân sách đã cạn → chặn trước khi gọi: 0 lời gọi STT, AI_BUDGET_EXHAUSTED', async () => {
      await useModel('blocked', 1);
      await inFreshAccount(async () => {
        const { stt, svc } = rig();
        await h.fake.setBudget({ used: 4_000_000 });
        const err = await run(svc, 90).catch((e: unknown) => e);
        expect((err as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
        expect(stt.transcribeCalls).toBe(0);
        expect(await h.fake.ledger()).toEqual([]);
      });
    });
  });

  describe('T053 – tệp trùng dấu tệp không phát sinh lời gọi STT lần nữa', () => {
    it('requestId media:{mediaId}:label lần hai → AI_DUPLICATE_REQUEST(settled), 0 lời gọi STT thêm, đúng 1 dòng sổ', async () => {
      await useModel('dup', 1);
      await inFreshAccount(async () => {
        const { stt, svc } = rig();
        stt.onTranscribe = () =>
          Promise.resolve({
            text: 'x',
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            modelId: current.modelId,
            audioSeconds: 90,
          });
        const id = `media:${crypto.randomUUID()}:label`;
        await run(svc, 90, id);
        const calls = stt.transcribeCalls;
        const before = await h.fake.getBudget();
        const err = await run(svc, 90, id).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AiError);
        expect((err as AiError).code).toBe('AI_DUPLICATE_REQUEST');
        expect((err as AiError).status).toBe('settled');
        expect(stt.transcribeCalls).toBe(calls);
        expect(await h.fake.ledger()).toHaveLength(1);
        expect(await h.fake.getBudget()).toMatchObject({ used: before.used, reserved: 0 });
      });
    });

    it('mã khác (tệp khác) vẫn chạy bình thường: hai mã → hai lời gọi, hai dòng sổ', async () => {
      await useModel('dup2', 1);
      await inFreshAccount(async () => {
        const { stt, svc } = rig();
        stt.onTranscribe = () =>
          Promise.resolve({
            text: 'x',
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            modelId: current.modelId,
            audioSeconds: 30,
          });
        await run(svc, 30, `media:${crypto.randomUUID()}:label`);
        await run(svc, 30, `media:${crypto.randomUUID()}:label`);
        expect(stt.transcribeCalls).toBe(2);
        expect(await h.fake.ledger()).toHaveLength(2);
      });
    });
  });
});
