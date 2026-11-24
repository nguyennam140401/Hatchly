import { describe, expect, it, vi } from 'vitest';
import { AiError, type AiRequest } from '../../../src/modules/ai_gateway';
import { weekStart } from '../../../src/modules/ai_gateway/internal/budget/system-budget';
import { SystemContextRequiredError } from '../../../src/modules/ai_gateway/internal/errors';
import { actualTokensCost } from '../../../src/modules/ai_gateway/internal/estimate';
import { DbPriceSource } from '../../../src/modules/ai_gateway/internal/prices/db-price-source';
import { AiSettings } from '../../../src/modules/ai_gateway/internal/settings/ai-settings';
import { asOwner } from '../../db/helpers/db';
import {
  insertPrice,
  reservationRows,
  stubRoutes,
  uniqueModel,
} from '../../ai_gateway/helpers/price-fixtures';
import type { AiHarness, DbStoreOptions } from './harness';
import { expectCustomerSafeRemedy } from './message-assert';

/** Nhà cung cấp của tuyến `tier`/`rank` đang cấu hình trong CSDL (chỉ chế độ db). */
async function routeProvider(tier: string, rank: number): Promise<string> {
  return asOwner(
    async (c) =>
      (
        await c.query<{ provider: string }>(
          'SELECT provider FROM ai_gateway.model_routes WHERE tier = $1 AND rank = $2',
          [tier, rank],
        )
      ).rows[0]!.provider,
  );
}

// Bộ kiểm thử hợp đồng Cổng AI (005, contracts/ai-gateway.md mục 5). Chạy với `memory` (pnpm test) và
// `sandbox` (pnpm test:db). Bất biến: used + reserved <= cap ở MỌI thời điểm quan sát.

const CAP = 4_000_000;
const req = (over: Partial<AiRequest> = {}): AiRequest => ({
  task: 'post_generation',
  prompt: {
    system: 'Bạn là trợ lý viết bài.',
    delta: 'PROMPT_CANARY_1 Viết bài khai trương quán cà phê.',
  },
  maxOutputTokens: 400,
  ...over,
});

/** Bộ sinh số giả ngẫu nhiên có hạt giống (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Quét đệ quy: không khóa tiền tệ, không số nguyên ≥ 1 000 ngoài `percent`. */
function assertNoMoney(value: unknown, path = ''): void {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1000) {
      throw new Error(`số lớn ở ${path}`);
    }
    return;
  }
  if (value instanceof Date) return;
  for (const [k, v] of Object.entries(value)) {
    if (/usd|micro|cost|amount|price/i.test(k)) throw new Error(`khóa tiền tệ ${path}.${k}`);
    assertNoMoney(v, `${path}.${k}`);
  }
}

export function describeAiGatewayContract(
  harness: () => AiHarness,
  opts: { concurrencyRounds: number; callsPerRound: number },
): void {
  const h = () => harness();
  /** Chế độ `db`: chu kỳ hiện hành do mốc tài khoản quyết định → không ghi đè `cycleStart` bằng ngày cố định. */
  const cycleOverride = (date: string): { cycleStart?: string } =>
    h().mode === 'db' ? {} : { cycleStart: date };

  async function withAccount<T>(fn: (accountId: string) => Promise<T>): Promise<T> {
    const id = await h().newAccount();
    return h().inAccount(id, () => fn(id));
  }

  describe('1. trình tự giữ chỗ → gọi → quyết toán', () => {
    it('ledger đủ trường, used tăng đúng chi phí thực, reserved = 0', async () => {
      await withAccount(async () => {
        const g = h().gateway();
        const r = await g.generate(req());
        expect(r.text).toMatch(/^\[fake:post_generation\]/);
        expect(r.modelTier).toBe('default');
        assertNoMoney(r);
        const [entry] = await h().fake.ledger();
        expect(entry).toMatchObject({
          task: 'post_generation',
          modelTier: 'default',
          inputTokens: r.usage.inputTokens,
          outputTokens: r.usage.outputTokens,
          anomaly: null,
          overCapMicroUsd: 0,
        });
        // Kho giả: nhãn bộ chuyển đổi. Kho db (015 T042): nhà cung cấp của TUYẾN thực sự trả kết quả (anthropic/openai…),
        // KHÔNG phải nhãn 'primary'/'fallback' của bộ chuyển đổi → đối soát hóa đơn theo nhà cung cấp mới đúng.
        if (h().mode === 'db') {
          expect(entry!.provider).toBe(await routeProvider('default', 1));
        } else {
          expect(entry!.provider).toBe('primary');
        }
        expect(entry!.costMicroUsd).toBeGreaterThan(0);
        expect(entry!.costMicroUsd).toBeLessThanOrEqual(entry!.estimateMicroUsd);
        const b = await h().fake.getBudget();
        expect(b).toMatchObject({ used: entry!.costMicroUsd, reserved: 0 });
        expect((await h().fake.reservations()).map((x) => x.state)).toEqual(['settled']);
      });
    });

    it('mọi lần gọi nhà cung cấp (chính và dự phòng) đều sau markCalling', async () => {
      await withAccount(async () => {
        const g = h().gateway();
        const seen: string[] = [];
        const observe = async () => {
          const states = (await h().fake.reservations()).filter((x) => x.state === 'calling');
          seen.push(states.length === 1 ? 'calling' : `sai:${states.length}`);
        };
        h().bundle.primary.onCall = observe;
        h().bundle.fallback.onCall = observe;
        try {
          await h().fake.script([{ fail: 'error' }], 'primary');
          await g.generate(req());
        } finally {
          h().bundle.primary.onCall = undefined;
          h().bundle.fallback.onCall = undefined;
        }
        expect(seen).toEqual(['calling', 'calling']);
      });
    });
  });

  describe('2. chặn trước khi gọi', () => {
    it('used + reserved + est > cap → AI_BUDGET_EXHAUSTED, nhà cung cấp nhận 0 lời gọi', async () => {
      await withAccount(async () => {
        const g = h().gateway();
        await h().fake.setBudget({ used: CAP - 10 });
        const before = h().bundle.primary.calls.length + h().bundle.fallback.calls.length;
        const err = await g.generate(req()).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AiError);
        expect((err as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
        expect((err as AiError).messageVi).toContain('giới hạn AI');
        expectCustomerSafeRemedy((err as AiError).messageVi);
        expect((err as AiError).retryable).toBe(false);
        expect(h().bundle.primary.calls.length + h().bundle.fallback.calls.length).toBe(before);
        expect(await h().fake.reservations()).toEqual([]);
      });
    });
  });

  describe('3. đồng thời', () => {
    it(`${opts.concurrencyRounds} vòng × ${opts.callsPerRound} lời gọi sát trần → không bao giờ vượt, reserved = 0 khi xong`, async () => {
      await withAccount(async () => {
        const g = h().gateway({ providerTimeoutMs: 5_000 });
        const store = h().bundle.store;
        const rand = seeded(20261112);
        let violations = 0;
        const observe = async () => {
          const s = await store.usage({
            scope: 'account',
            cycleStart: await store.currentCycleStart(),
          });
          if (s.used + s.reserved > s.cap || s.reserved < 0) violations++;
        };
        const wrap = (k: 'reserve' | 'release' | 'settle' | 'markCalling') => {
          const original = store[k].bind(store) as (...a: unknown[]) => Promise<unknown>;
          (store as unknown as Record<string, unknown>)[k] = async (...a: unknown[]) => {
            const r = await original(...a);
            await observe();
            return r;
          };
          return () => {
            (store as unknown as Record<string, unknown>)[k] = original;
          };
        };
        const restore = (['reserve', 'release', 'settle', 'markCalling'] as const).map(wrap);
        try {
          let ok = 0;
          let blocked = 0;
          for (let round = 0; round < opts.concurrencyRounds; round++) {
            await h().fake.setBudget({ used: 0, reserved: 0, cap: 100_000 });
            await h().fake.script(
              Array.from({ length: opts.callsPerRound * 2 }, () => ({
                latencyMs: Math.floor(rand() * 5),
                ...(rand() < 0.1 ? { fail: 'error' as const } : {}),
                actualCostMultiplier: rand() < 0.1 ? 3 : 1,
              })),
            );
            const results = await Promise.allSettled(
              Array.from({ length: opts.callsPerRound }, () =>
                g.generate(req({ maxOutputTokens: 200 + Math.floor(rand() * 1800) })),
              ),
            );
            for (const r of results) {
              if (r.status === 'fulfilled') ok++;
              else if ((r.reason as AiError).code === 'AI_BUDGET_EXHAUSTED') blocked++;
              else if ((r.reason as AiError).code !== 'AI_PROVIDER_UNAVAILABLE') throw r.reason;
            }
            await h().fake.reset();
            const b = await h().fake.getBudget();
            expect(b.reserved).toBe(0);
          }
          expect(violations).toBe(0);
          expect(ok).toBeGreaterThan(0);
          expect(blocked).toBeGreaterThan(0);
        } finally {
          for (const r of restore) r();
        }
      });
    }, 300_000);
  });

  describe('4. ngưỡng mềm và hạng mô hình', () => {
    it('< 2 USD → default; ≥ 2 USD → cheap; gán nhãn → cheap_vision; STT → stt', async () => {
      await withAccount(async () => {
        const g = h().gateway();
        await h().fake.setBudget({ used: 1_999_000 });
        expect((await g.generate(req({ maxOutputTokens: 10 }))).modelTier).toBe('default');
        await h().fake.setBudget({ used: 2_000_000 });
        expect((await g.generate(req())).modelTier).toBe('cheap');
        expect((await g.generate(req({ task: 'topic_suggestion' }))).modelTier).toBe('cheap');
        expect(
          (
            await g.generate(
              req({ task: 'image_labeling', images: [{ url: 'https://x/1.jpg', bytes: 1 }] }),
            )
          ).modelTier,
        ).toBe('cheap_vision');
        expect((await g.generate(req({ task: 'video_labeling' }))).modelTier).toBe('cheap_vision');
        expect(
          (await g.transcribe({ audioUrl: 'https://x/a.mp3', durationSec: 10, language: 'vi' }))
            .modelTier,
        ).toBe('stt');
      });
    });
  });

  describe('5. dự phòng', () => {
    it('chính lỗi → dự phòng đúng 1 lần', async () => {
      await withAccount(async () => {
        const g = h().gateway();
        const p0 = h().bundle.primary.calls.length;
        const f0 = h().bundle.fallback.calls.length;
        await h().fake.script([{ fail: 'error' }], 'primary');
        await g.generate(req());
        expect(h().bundle.primary.calls.length - p0).toBe(1);
        expect(h().bundle.fallback.calls.length - f0).toBe(1);
        // Kho db (015 T042): nhà cung cấp của tuyến rank 2 (khác rank 1), không phải nhãn 'fallback'.
        expect((await h().fake.ledger()).map((l) => l.provider)).toEqual([
          h().mode === 'db' ? await routeProvider('default', 2) : 'fallback',
        ]);
      });
    });

    it('chính hết giờ + dự phòng lỗi → AI_PROVIDER_UNAVAILABLE, reserved = 0', async () => {
      await withAccount(async () => {
        const g = h().gateway({ providerTimeoutMs: 100 });
        await h().fake.script([{ fail: 'timeout' }], 'primary');
        await h().fake.script([{ fail: 'error' }], 'fallback');
        const err = await g.generate(req()).catch((e: unknown) => e as AiError);
        expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
        expect((err as AiError).retryable).toBe(true);
        expect((await h().fake.getBudget()).reserved).toBe(0);
        expect((await h().fake.reservations()).map((r) => r.state)).toEqual([
          'released',
          'released',
        ]);
        expect(await h().fake.ledger()).toEqual([]);
      });
    });
  });

  describe('6. trả dần', () => {
    it('đủ luồng → quyết toán; bị hủy giữa chừng → quyết toán phần đã sinh, reserved = 0', async () => {
      await withAccount(async () => {
        const g = h().gateway({ providerTimeoutMs: 10_000 });
        const full = g.generateStream(req({ maxOutputTokens: 40 }));
        let text = '';
        for await (const c of full) text += c.delta;
        expect((await full.result).text).toBe(text);

        await h().fake.script([{ outputTokens: 4000 }], 'primary');
        const s = g.generateStream(req({ maxOutputTokens: 4000 }));
        let got = 0;
        for await (const c of s) {
          got += c.delta.length;
          if (got >= 64) s.cancel();
        }
        const partial = await s.result;
        expect(partial.usage.outputTokens).toBeGreaterThan(0);
        expect(partial.usage.outputTokens).toBeLessThan(4000);
        const ledger = await h().fake.ledger();
        expect(ledger).toHaveLength(2);
        expect(ledger[1]!.outputTokens).toBe(partial.usage.outputTokens);
        expect((await h().fake.getBudget()).reserved).toBe(0);
      });
    });

    it('hủy trước chữ đầu tiên → trả giữ chỗ, không ghi sổ', async () => {
      await withAccount(async () => {
        const g = h().gateway({ providerTimeoutMs: 10_000, firstTokenTimeoutMs: 5_000 });
        await h().fake.script([{ firstTokenMs: 2_000 }], 'primary');
        const s = g.generateStream(req());
        setTimeout(() => {
          s.cancel();
        }, 50);
        for await (const chunk of s) {
          expect(chunk).toBeUndefined(); // không có chữ nào
        }
        await s.result;
        expect(await h().fake.ledger()).toEqual([]);
        expect((await h().fake.getBudget()).reserved).toBe(0);
      });
    });
  });

  describe('7. chuyển giọng nói', () => {
    it('ước tính theo min(durationSec, 300)', async () => {
      await withAccount(async () => {
        const g = h().gateway();
        await g.transcribe({ audioUrl: 'https://x/a.mp3', durationSec: 1000, language: 'vi' });
        await g.transcribe({ audioUrl: 'https://x/b.mp3', durationSec: 120, language: 'vi' });
        expect((await h().fake.ledger()).map((l) => l.estimateMicroUsd)).toEqual([30_000, 12_000]);
      });
    });
  });

  describe('8. getUsage chỉ phần trăm', () => {
    it('không khóa/giá trị tiền tệ; percent = floor((used+reserved)/cap×100); trạng thái theo ngưỡng', async () => {
      await withAccount(async () => {
        const g = h().gateway();
        await h().fake.setBudget({ used: 1_234_567, reserved: 0 });
        const u = await g.getUsage();
        assertNoMoney(u);
        expect(Object.keys(u).sort()).toEqual(['nextCycleStartsAt', 'percent', 'state']);
        expect(u).toMatchObject({ percent: 30, state: 'normal' });
        expect(u.nextCycleStartsAt.getTime()).toBeGreaterThan(Date.now() - 31 * 86_400_000);
        await h().fake.setBudget({ used: 2_000_000 });
        expect(await g.getUsage()).toMatchObject({ percent: 50, state: 'cheap_model' });
        await h().fake.setBudget({ used: CAP - 1 });
        expect(await g.getUsage()).toMatchObject({ percent: 99, state: 'blocked' });
        await h().fake.setBudget({ used: CAP });
        expect(await g.getUsage()).toMatchObject({ percent: 100, state: 'blocked' });
      });
    });
  });

  describe('9. kẹp trần', () => {
    it('actual > est → sổ ghi chi phí thực + over_estimate; used kẹp ≤ cap', async () => {
      await withAccount(async () => {
        const g = h().gateway();
        // Phần còn lại 1.000 đủ cho ước tính theo giá THẬT của kho db (cheap ~ vài trăm micro-USD) mà chi phí thực x50 vẫn vượt.
        await h().fake.setBudget({ used: 2_000_000, cap: 2_001_000 });
        await h().fake.script([{ actualCostMultiplier: 50, outputTokens: 40 }], 'primary');
        await g.generate(req({ maxOutputTokens: 40 }));
        const [entry] = await h().fake.ledger();
        expect(entry!.anomaly).toBe('over_estimate');
        expect(entry!.costMicroUsd).toBeGreaterThan(entry!.estimateMicroUsd);
        const b = await h().fake.getBudget();
        expect(b.used + b.reserved).toBeLessThanOrEqual(b.cap);
        expect(b.used).toBe(Math.min(2_000_000 + entry!.costMicroUsd, b.cap));
        expect(entry!.overCapMicroUsd).toBe(2_000_000 + entry!.costMicroUsd - b.used);
      });
      expect(h().logText()).toContain('ai.cost_anomaly');
    });
  });

  describe('10. giữ chỗ treo > 15 phút', () => {
    it('held → trả lại; calling → quyết toán theo ước tính (sổ unsettled); chạy lần hai không đổi', async () => {
      await withAccount(async () => {
        const store = h().bundle.store;
        const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
        const held = await store.reserve(key, 1_000, {
          task: 'post_generation',
          modelTier: 'default',
        });
        const calling = await store.reserve(key, 5_000, {
          task: 'post_generation',
          modelTier: 'default',
        });
        if (!held.ok || !calling.ok) throw new Error('giữ chỗ phải thành công');
        await store.markCalling(calling.reservationId); // nhà cung cấp đã nhận, tiến trình "chết" trước settle
        const fresh = await store.reserve(key, 7, {
          task: 'post_generation',
          modelTier: 'default',
        });
        await h().fake.ageReservations(16 * 60_000);
        if (fresh.ok) await store.release(fresh.reservationId);
        const fresh2 = await store.reserve(key, 9, {
          task: 'post_generation',
          modelTier: 'default',
        });

        expect(await store.releaseStale(15 * 60_000)).toEqual({
          released: 1,
          settledAtEstimate: 1,
        });
        const b = await h().fake.getBudget();
        expect(b.used).toBe(5_000);
        expect(b.reserved).toBe(9); // giữ chỗ < 15 phút không bị đụng
        const ledger = await h().fake.ledger();
        expect(ledger).toHaveLength(1);
        expect(ledger[0]).toMatchObject({
          anomaly: 'unsettled',
          costMicroUsd: 5_000,
          inputTokens: 0,
          outputTokens: 0,
        });

        expect(await store.releaseStale(15 * 60_000)).toEqual({
          released: 0,
          settledAtEstimate: 0,
        });
        expect(await h().fake.getBudget()).toMatchObject({ used: 5_000, reserved: 9 });
        if (fresh2.ok) await store.release(fresh2.reservationId);
      });
      expect(h().logText()).toContain('ai.unsettled_reservation');
    });
  });

  describe('11. việc hệ thống', () => {
    it('trong ngữ cảnh tài khoản → ném; ngoài → ngân sách tuần, không chạm tài khoản', async () => {
      const accountId = await h().newAccount();
      const g = h().gateway();
      const sys = {
        ...req({ task: 'trend_summary' }),
        task: 'trend_summary' as const,
        industryId: '01900000-0000-7000-8000-000000000001',
      };
      await h().inAccount(accountId, async () => {
        await expect(g.system.generate(sys)).rejects.toBeInstanceOf(SystemContextRequiredError);
      });
      const before = await h().inAccount(accountId, () => g.getUsage());
      await h().inSystem(async () => {
        await h().bundle.store.setSystemBudget({ used: 0, reserved: 0, cap: 2_000_000 });
        const r = await g.system.generate(sys);
        expect(r.modelTier).toBe('cheap');
        await h().bundle.store.setSystemBudget({ used: 2_000_000 });
        const err = await g.system.generate(sys).catch((e: unknown) => e as AiError);
        expect((err as AiError).code).toBe('AI_SYSTEM_BUDGET_EXHAUSTED');
        await h().bundle.store.setSystemBudget({ used: 0, reserved: 0 });
      });
      expect(await h().inAccount(accountId, () => g.getUsage())).toEqual(before);
      expect(await h().inAccount(accountId, () => h().fake.ledger())).toEqual([]);
      expect(h().logText()).toContain('ai.system_budget_exhausted');
    });
  });

  describe('12. sự kiện 80% / 100% (T080)', () => {
    it('mỗi mốc đúng 1 sự kiện trong chu kỳ; chu kỳ mới phát lại được', async () => {
      await withAccount(async () => {
        const g = h().gateway({ onCrossed: h().notify.onCrossed });
        await h().fake.setBudget({ used: 3_199_000, ...cycleOverride('2026-11-01') });
        await h().fake.script([{ actualCostMultiplier: 40, outputTokens: 40 }], 'primary');
        await g.generate(req({ maxOutputTokens: 40 })); // vượt 80%
        await g.generate(req({ maxOutputTokens: 40 })); // vẫn trên 80% – không phát lại
        expect(await h().notify.count('ai_usage_80')).toBe(1);
        expect(await h().notify.count('ai_usage_100')).toBe(0);
        await h().fake.setBudget({ used: 3_999_000 });
        await h().fake.script([{ actualCostMultiplier: 100, outputTokens: 40 }], 'primary');
        await g.generate(req({ maxOutputTokens: 40 }));
        expect(await h().notify.count('ai_usage_100')).toBe(1);
        expect(await h().notify.count('ai_usage_80')).toBe(1);
        // Chu kỳ mới: cờ mới → phát lại được. Chế độ `db`: chu kỳ hiện hành suy ra từ mốc của tài khoản (không đặt
        // tay được) → phần này do mục 16 kiểm.
        if (h().mode !== 'db') {
          await h().fake.setBudget({ used: 3_199_000, cycleStart: '2026-12-01' });
          await h().fake.script([{ actualCostMultiplier: 40, outputTokens: 40 }], 'primary');
          await g.generate(req({ maxOutputTokens: 40 }));
          expect(await h().notify.count('ai_usage_80')).toBe(2);
        }
      });
    });
  });

  describe('13. sự kiện cùng giao dịch quyết toán (chỉ sandbox)', () => {
    it('emit ném → không cờ, không sổ, không sự kiện; quyết toán lại → đúng 1 sự kiện', async (ctx) => {
      if (!h().hasRealTx) {
        ctx.skip(); // memory: không có giao dịch thật để hủy (research R9b)
        return;
      }
      await withAccount(async () => {
        let fail = true;
        const g = h().gateway({
          onCrossed: async (tx, crossed, cycle) => {
            await h().notify.onCrossed(tx, crossed, cycle);
            if (fail) throw new Error('emit lỗi');
          },
        });
        await h().fake.setBudget({ used: 3_199_000, ...cycleOverride('2026-11-01') });
        await h().fake.script([{ actualCostMultiplier: 40, outputTokens: 40 }], 'primary');
        await g.generate(req({ maxOutputTokens: 40 })); // nhà cung cấp đã trả lời → vẫn trả kết quả
        const b = await h().fake.getBudget();
        expect(b).toMatchObject({ notified80: false, used: 3_199_000 });
        expect(b.reserved).toBeGreaterThan(0); // giữ chỗ còn `calling`, chờ releaseStale
        expect(await h().fake.ledger()).toEqual([]);
        expect(await h().notify.count('ai_usage_80')).toBe(0);
        expect((await h().fake.reservations()).map((r) => r.state)).toEqual(['calling']);
        // Gỡ lỗi, quyết toán lại (như releaseStale) → đúng 1 sự kiện.
        fail = false;
        const [r] = await h().fake.reservations();
        await h().bundle.store.settle(
          r!.id,
          r!.estimateMicroUsd + 5_000, // chi phí thực vượt mốc 80% (như lần gọi bị hủy)
          {
            task: 'post_generation',
            modelTier: 'default',
            modelId: 'm',
            provider: 'primary',
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            traceId: null,
          },
          { onCrossed: (tx, crossed) => h().notify.onCrossed(tx, crossed, '2026-11-01') },
        );
        expect(await h().notify.count('ai_usage_80')).toBe(1);
        expect((await h().fake.getBudget()).notified80).toBe(true);
      });
      expect(h().logText()).toContain('ai.settle_failed');
    });
  });

  describe('15. mã yêu cầu logic – requestId (015, FR-037a)', () => {
    const rid = () => `post:${crypto.randomUUID()}:gen:1`;
    const providerCalls = () => h().bundle.primary.calls.length + h().bundle.fallback.calls.length;
    const DUPLICATE_VI = 'Yêu cầu này đã được xử lý hoặc đang xử lý';
    const expectDuplicateMessage = (m: string): void => {
      expect(m).toContain(DUPLICATE_VI);
      expectCustomerSafeRemedy(m);
    };

    it('cùng mã hai lần tuần tự → lần hai AI_DUPLICATE_REQUEST(settled), 0 lời gọi nhà cung cấp, đúng 1 dòng sổ', async (ctx) => {
      if (!h().supportsRequestId) {
        ctx.skip();
        return;
      }
      await withAccount(async () => {
        const g = h().gateway();
        const id = rid();
        await g.generate(req({ requestId: id }));
        const calls = providerCalls();
        const before = await h().fake.getBudget();
        const err = await g.generate(req({ requestId: id })).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AiError);
        expect((err as AiError).code).toBe('AI_DUPLICATE_REQUEST');
        expect((err as AiError).status).toBe('settled');
        expectDuplicateMessage((err as AiError).messageVi);
        expect((err as AiError).retryable).toBe(false);
        expect(providerCalls()).toBe(calls);
        expect(await h().fake.ledger()).toHaveLength(1);
        expect(await h().fake.getBudget()).toMatchObject({ used: before.used, reserved: 0 });
        expect((await h().fake.reservations()).map((r) => r.state)).toEqual(['settled']);
      });
    });

    it('hai lần đồng thời cùng mã → một chạy, một AI_DUPLICATE_REQUEST(in_progress); chỉ 1 lời gọi và 1 dòng sổ', async (ctx) => {
      if (!h().supportsRequestId) {
        ctx.skip();
        return;
      }
      await withAccount(async () => {
        const g = h().gateway({ providerTimeoutMs: 5_000 });
        const id = rid();
        await h().fake.script([{ latencyMs: 400 }], 'primary');
        const calls = providerCalls();
        const results = await Promise.allSettled([
          g.generate(req({ requestId: id })),
          g.generate(req({ requestId: id })),
        ]);
        const ok = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(ok).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0]!.reason).toBeInstanceOf(AiError);
        expect((rejected[0]!.reason as AiError).code).toBe('AI_DUPLICATE_REQUEST');
        expect((rejected[0]!.reason as AiError).status).toBe('in_progress');
        expect(providerCalls() - calls).toBe(1);
        expect(await h().fake.ledger()).toHaveLength(1);
        expect((await h().fake.getBudget()).reserved).toBe(0);
      });
    });

    it('lần đầu lỗi nhà cung cấp (giữ chỗ đã released) → thử lại cùng mã chạy được, đúng 1 dòng sổ', async (ctx) => {
      if (!h().supportsRequestId) {
        ctx.skip();
        return;
      }
      await withAccount(async () => {
        const g = h().gateway();
        const id = rid();
        await h().fake.script([{ fail: 'error' }], 'primary');
        await h().fake.script([{ fail: 'error' }], 'fallback');
        const err = await g.generate(req({ requestId: id })).catch((e: unknown) => e);
        expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
        expect((await h().fake.reservations()).map((r) => r.state)).toEqual([
          'released',
          'released',
        ]);
        expect(await h().fake.ledger()).toEqual([]);
        const r = await g.generate(req({ requestId: id }));
        expect(r.text).toMatch(/^\[fake:post_generation\]/);
        expect(await h().fake.ledger()).toHaveLength(1);
        const b = await h().fake.getBudget();
        expect(b.reserved).toBe(0);
        expect(b.used).toBe((await h().fake.ledger())[0]!.costMicroUsd);
      });
    });

    it('không có requestId → luôn là lời gọi mới; mã khác nhau độc lập', async () => {
      await withAccount(async () => {
        const g = h().gateway();
        await g.generate(req());
        await g.generate(req());
        await g.generate(req({ requestId: rid() }));
        await g.generate(req({ requestId: rid() }));
        expect(await h().fake.ledger()).toHaveLength(4);
      });
    });

    it('cùng mã ở hai tài khoản khác nhau không va chạm (phạm vi theo tài khoản)', async (ctx) => {
      if (!h().supportsRequestId) {
        ctx.skip();
        return;
      }
      const id = rid();
      for (let i = 0; i < 2; i++) {
        await withAccount(async () => {
          await h()
            .gateway()
            .generate(req({ requestId: id }));
          expect(await h().fake.ledger()).toHaveLength(1);
        });
      }
    });

    it('mã sai định dạng → AI_INVALID_REQUEST, 0 lời gọi, không giữ chỗ', async () => {
      await withAccount(async () => {
        const g = h().gateway();
        const calls = providerCalls();
        for (const bad of ['', 'có dấu', 'a b', 'x'.repeat(129), 'a/b', 'a;b']) {
          const err = await g.generate(req({ requestId: bad })).catch((e: unknown) => e);
          expect(err).toBeInstanceOf(AiError);
          expect((err as AiError).code).toBe('AI_INVALID_REQUEST');
        }
        expect(providerCalls()).toBe(calls);
        expect(await h().fake.reservations()).toEqual([]);
      });
    });

    it('chuyển giọng nói cùng mã hai lần → lần hai AI_DUPLICATE_REQUEST(settled), 1 dòng sổ', async (ctx) => {
      if (!h().supportsRequestId) {
        ctx.skip();
        return;
      }
      await withAccount(async () => {
        const g = h().gateway();
        const id = `media:${crypto.randomUUID()}:stt`;
        const stt = { audioUrl: 'https://x/a.mp3', durationSec: 60, language: 'vi' as const };
        await g.transcribe({ ...stt, requestId: id });
        const err = await g.transcribe({ ...stt, requestId: id }).catch((e: unknown) => e);
        expect((err as AiError).code).toBe('AI_DUPLICATE_REQUEST');
        expect((err as AiError).status).toBe('settled');
        expect(await h().fake.ledger()).toHaveLength(1);
      });
    });
  });

  describe('16. chu kỳ theo mốc tài khoản (015, FR-014; chỉ kho db)', () => {
    /** Ngày hôm nay theo UTC+7. */
    const todayVn = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const daysIn = (ymd: string) => {
      const [y, m] = ymd.split('-').map(Number) as [number, number];
      return new Date(Date.UTC(y, m, 0)).getUTCDate();
    };
    const monthIndex = (ymd: string) => {
      const [y, m] = ymd.split('-').map(Number) as [number, number];
      return y * 12 + m;
    };

    // 29/30/31, tháng 2 (28 và năm nhuận 29/02), cuối năm, mồng 1.
    for (const anchor of [
      '2026-01-29',
      '2026-01-30',
      '2026-01-31',
      '2024-02-29',
      '2026-02-28',
      '2025-12-31',
      '2026-03-01',
    ]) {
      it(`mốc ${anchor}: chu kỳ lặp hằng tháng, tháng thiếu ngày → ngày cuối tháng, hôm nay nằm trong [start, end)`, async (ctx) => {
        const db = h().db;
        if (db === undefined) {
          ctx.skip();
          return;
        }
        const accountId = await db.accountWithAnchor(anchor);
        await h().inAccount(accountId, async () => {
          const g = h().gateway();
          await g.generate(req({ maxOutputTokens: 10 }));
          const rows = await db.budgetRows();
          expect(rows).toHaveLength(1);
          const row = rows[0]!;
          const anchorDay = Number(anchor.slice(8));
          // Quy tắc hiến chương: ngày chu kỳ = min(ngày mốc, số ngày của tháng đó), cả đầu lẫn cuối chu kỳ.
          expect(Number(row.cycle_start.slice(8))).toBe(
            Math.min(anchorDay, daysIn(row.cycle_start)),
          );
          expect(Number(row.cycle_end.slice(8))).toBe(Math.min(anchorDay, daysIn(row.cycle_end)));
          expect(monthIndex(row.cycle_end) - monthIndex(row.cycle_start)).toBe(1);
          expect(row.cycle_start <= todayVn()).toBe(true);
          expect(todayVn() < row.cycle_end).toBe(true);
          // Giá trị khởi tạo chụp từ cấu hình: trần 4 USD, ngưỡng mềm 2 USD.
          expect(row).toMatchObject({ cap: CAP, soft_limit: 2_000_000, notified_80: false });
          // Khách chỉ thấy phần trăm + thời điểm chu kỳ kế = cycle_end 00:00 UTC+7.
          const usage = await g.getUsage();
          expect(usage.nextCycleStartsAt.getTime()).toBe(
            Date.parse(`${row.cycle_end}T00:00:00+07:00`),
          );
          expect(usage.percent).toBeLessThan(5);
        });
      });
    }

    it('tài khoản tạo hôm nay: chu kỳ bắt đầu từ hôm nay (UTC+7)', async (ctx) => {
      const db = h().db;
      if (db === undefined) {
        ctx.skip();
        return;
      }
      await withAccount(async () => {
        await h()
          .gateway()
          .generate(req({ maxOutputTokens: 10 }));
        const [row] = await db.budgetRows();
        expect(row!.cycle_start).toBe(todayVn());
      });
    });

    it('hai yêu cầu đầu chu kỳ đồng thời → đúng 1 dòng ai_budgets, cả hai quyết toán', async (ctx) => {
      const db = h().db;
      if (db === undefined) {
        ctx.skip();
        return;
      }
      await withAccount(async () => {
        const g = h().gateway({ providerTimeoutMs: 5_000 });
        const results = await Promise.all(
          Array.from({ length: 6 }, () => g.generate(req({ maxOutputTokens: 20 }))),
        );
        expect(results).toHaveLength(6);
        const rows = await db.budgetRows();
        expect(rows).toHaveLength(1);
        const ledger = await h().fake.ledger();
        expect(ledger).toHaveLength(6);
        expect(rows[0]).toMatchObject({
          used: ledger.reduce((s, l) => s + l.costMicroUsd, 0),
          reserved: 0,
        });
      });
    });

    it('chu kỳ mới đặt lại số dùng và cờ 80/100: chu kỳ cũ đã cạn trần không chặn chu kỳ mới', async (ctx) => {
      const db = h().db;
      if (db === undefined) {
        ctx.skip();
        return;
      }
      await withAccount(async () => {
        const past = await db.seedExhaustedPastCycle();
        const g = h().gateway();
        await g.generate(req({ maxOutputTokens: 10 })); // không bị chặn
        const rows = await db.budgetRows();
        expect(rows).toHaveLength(2);
        const [current, old] = rows as [(typeof rows)[number], (typeof rows)[number]];
        expect(old.cycle_start).toBe(past);
        expect(old).toMatchObject({
          used: CAP,
          reserved: 0,
          notified_80: true,
          notified_100: true,
        });
        expect(current.cycle_start > past).toBe(true);
        expect(current).toMatchObject({ reserved: 0, notified_80: false, notified_100: false });
        expect(current.used).toBeGreaterThan(0);
        expect(current.used).toBeLessThan(CAP / 100);
      });
    });
  });

  describe('18. bảng giá chỉ-thêm, hiệu lực theo thời điểm (015, FR-019/020/022, SC-007; chỉ kho db)', () => {
    const HOUR = 3_600_000;
    const PRICE_A = { input: 1_000_000, output: 2_000_000, cached: 100_000 };
    const PRICE_B = { input: 3_000_000, output: 6_000_000, cached: 300_000 };
    const entryOf = (p: { input: number; output: number; cached: number }) => ({
      modelTier: 'default' as const,
      modelId: 'x',
      provider: 'x',
      inputPerMTokMicroUsd: p.input,
      outputPerMTokMicroUsd: p.output,
      cachedInputPerMTokMicroUsd: p.cached,
      effectiveFrom: new Date(0),
    });

    it('giá đổi giữa chừng: quyết toán dùng price_id của giữ chỗ (giá A), lời gọi sau đó dùng giá B', async (ctx) => {
      const db = h().db;
      if (db === undefined) {
        ctx.skip();
        return;
      }
      const m = uniqueModel();
      const priceA = await insertPrice(m, {
        ...PRICE_A,
        effectiveFrom: new Date(Date.now() - HOUR),
      });
      const gw = await db.gatewayWith(
        { routes: stubRoutes(m), prices: new DbPriceSource({ ttlMs: 0 }) },
        { providerTimeoutMs: 5_000 },
      );
      await withAccount(async (accountId) => {
        let priceB: string | undefined;
        // Giữa chừng (SAU khi đã giữ chỗ, TRƯỚC khi quyết toán) thêm dòng giá B có hiệu lực từ 1 giây trước: nếu quyết toán
        // tra lại giá theo thời điểm hiện tại sẽ lấy nhầm B.
        h().bundle.primary.onCall = async () => {
          priceB = await insertPrice(m, {
            ...PRICE_B,
            effectiveFrom: new Date(Date.now() - 1_000),
          });
        };
        const first = await gw.generate(req({ maxOutputTokens: 30 })).finally(() => {
          h().bundle.primary.onCall = undefined;
        });
        const second = await gw.generate(req({ maxOutputTokens: 30 }));

        const rows = await reservationRows(accountId);
        expect(rows.map((r) => [r.state, r.price_id])).toEqual([
          ['settled', priceA],
          ['settled', priceB],
        ]);
        const [e1, e2] = await h().fake.ledger();
        expect(e1!.costMicroUsd).toBe(actualTokensCost(entryOf(PRICE_A), first.usage));
        expect(e1!.costMicroUsd).not.toBe(actualTokensCost(entryOf(PRICE_B), first.usage));
        expect(e2!.costMicroUsd).toBe(actualTokensCost(entryOf(PRICE_B), second.usage));
        expect(e1!.modelId).toBe(m.modelId);
        expect(e1!.provider).toBe(m.provider);
        // Số dùng = tổng sổ (không có phần kẹp), không tính lại lời gọi cũ.
        const b = await h().fake.getBudget();
        expect(b).toMatchObject({ used: e1!.costMicroUsd + e2!.costMicroUsd, reserved: 0 });
      });
    });

    it('dòng giá hiệu lực trong tương lai chưa được dùng; dòng hiệu lực gần nhất ≤ bây giờ được dùng', async (ctx) => {
      const db = h().db;
      if (db === undefined) {
        ctx.skip();
        return;
      }
      const m = uniqueModel();
      const old = await insertPrice(m, {
        ...PRICE_B,
        effectiveFrom: new Date(Date.now() - 2 * HOUR),
      });
      const current = await insertPrice(m, {
        ...PRICE_A,
        effectiveFrom: new Date(Date.now() - HOUR),
      });
      await insertPrice(m, { ...PRICE_B, effectiveFrom: new Date(Date.now() + HOUR) });
      const gw = await db.gatewayWith({
        routes: stubRoutes(m),
        prices: new DbPriceSource({ ttlMs: 0 }),
      });
      await withAccount(async (accountId) => {
        const r = await gw.generate(req({ maxOutputTokens: 30 }));
        const [row] = await reservationRows(accountId);
        expect(row!.price_id).toBe(current);
        expect(row!.price_id).not.toBe(old);
        const [entry] = await h().fake.ledger();
        expect(entry!.costMicroUsd).toBe(actualTokensCost(entryOf(PRICE_A), r.usage));
      });
    });

    it('thiếu giá hợp lệ → AI_NOT_CONFIGURED + cảnh báo ai.price_missing, 0 lời gọi, không giữ chỗ, không sổ', async (ctx) => {
      const db = h().db;
      if (db === undefined) {
        ctx.skip();
        return;
      }
      const m = uniqueModel('noprice'); // tuyến trỏ tới mô hình chưa có dòng giá nào
      const future = uniqueModel('futureonly'); // chỉ có giá hiệu lực tương lai = chưa có giá hợp lệ
      await insertPrice(future, { effectiveFrom: new Date(Date.now() + HOUR) });
      for (const model of [m, future]) {
        const gw = await db.gatewayWith({
          routes: stubRoutes(model),
          prices: new DbPriceSource({ ttlMs: 0 }),
        });
        await withAccount(async () => {
          const calls = () => h().bundle.primary.calls.length + h().bundle.fallback.calls.length;
          const before = calls();
          const err = await gw.generate(req()).catch((e: unknown) => e as AiError);
          expect((err as AiError).code).toBe('AI_NOT_CONFIGURED');
          expect(calls()).toBe(before);
          expect(await h().fake.reservations()).toHaveLength(0);
          expect(await h().fake.ledger()).toHaveLength(0);
          expect(await h().fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
        });
      }
      expect(h().logText()).toContain('ai.price_missing');
    });
  });

  describe('17. dự phòng theo loại việc (015 US4, FR-024a, SC-008; chỉ kho db)', () => {
    // Đỏ tạm tới khi T048: cổng còn lặp cứng [primary, fallback] (hành vi 005) thay vì theo `attemptsFor`, và thiếu giá của
    // lượt dự phòng còn ném AI_NOT_CONFIGURED (từ `attemptRoute`) thay vì bỏ lượt → AI_PROVIDER_UNAVAILABLE.
    const HOUR = 3_600_000;
    const CHEAP = { input: 1_000_000, output: 2_000_000, cached: 100_000 };
    const PRICEY = { input: 1_000_000_000, output: 2_000_000_000, cached: 100_000_000 };
    const callsOf = () => ({
      primary: h().bundle.primary.calls.length,
      fallback: h().bundle.fallback.calls.length,
    });

    async function seededModel(price: typeof CHEAP | null) {
      const m = uniqueModel();
      if (price !== null) {
        await insertPrice(m, { ...price, effectiveFrom: new Date(Date.now() - HOUR) });
      }
      return m;
    }

    it('chính lỗi → release, giữ lại theo giá dự phòng, gọi dự phòng đúng 1 lần, sổ ghi nhà cung cấp dự phòng', async (ctx) => {
      const db = h().db;
      if (db === undefined) {
        ctx.skip();
        return;
      }
      const primaryModel = await seededModel(CHEAP);
      const fallbackModel = await seededModel({
        input: 3_000_000,
        output: 6_000_000,
        cached: 300_000,
      });
      const gw = await db.gatewayWith(
        {
          routes: stubRoutes(primaryModel, fallbackModel),
          prices: new DbPriceSource({ ttlMs: 0 }),
        },
        { providerTimeoutMs: 5_000 },
      );
      await withAccount(async (accountId) => {
        const before = callsOf();
        await h().fake.script([{ fail: 'error' }], 'primary');
        const r = await gw.generate(req({ maxOutputTokens: 30 }));
        const after = callsOf();
        expect(after.primary - before.primary).toBe(1);
        expect(after.fallback - before.fallback).toBe(1);

        const rows = await reservationRows(accountId);
        expect(rows.map((x) => [x.state, x.provider, x.model_id])).toEqual([
          ['released', primaryModel.provider, primaryModel.modelId],
          ['settled', fallbackModel.provider, fallbackModel.modelId],
        ]);
        // Dòng giữ chỗ thứ hai mang price_id của GIÁ DỰ PHÒNG (khác giá chính).
        expect(rows[1]!.price_id).not.toBe(rows[0]!.price_id);

        const [entry, ...rest] = await h().fake.ledger();
        expect(rest).toEqual([]);
        expect(entry).toMatchObject({
          provider: fallbackModel.provider,
          modelId: fallbackModel.modelId,
        });
        // Chi phí thực tính theo GIÁ DỰ PHÒNG.
        expect(entry!.costMicroUsd).toBe(
          actualTokensCost(
            {
              modelTier: 'default',
              modelId: fallbackModel.modelId,
              provider: fallbackModel.provider,
              inputPerMTokMicroUsd: 3_000_000,
              outputPerMTokMicroUsd: 6_000_000,
              cachedInputPerMTokMicroUsd: 300_000,
              effectiveFrom: new Date(0),
            },
            r.usage,
          ),
        );
        // SC-008: lượt chính đã trả hết; số dùng = đúng chi phí lượt dự phòng.
        expect(await h().fake.getBudget()).toMatchObject({
          used: entry!.costMicroUsd,
          reserved: 0,
        });
      });
    });

    it('cả hai lượt lỗi → AI_PROVIDER_UNAVAILABLE, reserved = 0, used = 0, không sổ', async (ctx) => {
      const db = h().db;
      if (db === undefined) {
        ctx.skip();
        return;
      }
      const a = await seededModel(CHEAP);
      const b = await seededModel(CHEAP);
      const gw = await db.gatewayWith(
        { routes: stubRoutes(a, b), prices: new DbPriceSource({ ttlMs: 0 }) },
        { providerTimeoutMs: 5_000 },
      );
      await withAccount(async (accountId) => {
        const before = callsOf();
        await h().fake.script([{ fail: 'error' }], 'primary');
        await h().fake.script([{ fail: 'error' }], 'fallback');
        const err = await gw.generate(req()).catch((e: unknown) => e as AiError);
        expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
        const after = callsOf();
        expect(after.primary - before.primary).toBe(1);
        expect(after.fallback - before.fallback).toBe(1);
        expect((await reservationRows(accountId)).map((x) => x.state)).toEqual([
          'released',
          'released',
        ]);
        expect(await h().fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
        expect(await h().fake.ledger()).toEqual([]);
      });
    });

    it('loại việc chưa bật dự phòng (attemptsFor chỉ có lượt chính) + lỗi → lỗi ngay, không lời gọi thứ hai', async (ctx) => {
      const db = h().db;
      if (db === undefined) {
        ctx.skip();
        return;
      }
      const only = await seededModel(CHEAP);
      const gw = await db.gatewayWith(
        { routes: stubRoutes(only), prices: new DbPriceSource({ ttlMs: 0 }) },
        { providerTimeoutMs: 5_000 },
      );
      await withAccount(async (accountId) => {
        const before = callsOf();
        await h().fake.script([{ fail: 'error' }], 'primary');
        const err = await gw.generate(req()).catch((e: unknown) => e as AiError);
        expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
        const after = callsOf();
        expect(after.primary - before.primary).toBe(1);
        expect(after.fallback - before.fallback).toBe(0);
        expect((await reservationRows(accountId)).map((x) => x.state)).toEqual(['released']);
        expect(await h().fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
      });
    });

    it('transcription chưa bật dự phòng + lỗi → AI_PROVIDER_UNAVAILABLE ngay, không lời gọi thứ hai', async (ctx) => {
      const db = h().db;
      if (db === undefined) {
        ctx.skip();
        return;
      }
      const stt = uniqueModel('stt');
      await insertPrice(stt, {
        unit: 'audio_minute',
        perMinute: 6_000,
        effectiveFrom: new Date(Date.now() - HOUR),
      });
      const gw = await db.gatewayWith(
        { routes: stubRoutes(stt), prices: new DbPriceSource({ ttlMs: 0 }) },
        { providerTimeoutMs: 5_000 },
      );
      await withAccount(async (accountId) => {
        const before = callsOf();
        await h().fake.script([{ fail: 'error' }], 'primary');
        const err = await gw
          .transcribe({ audioUrl: 'https://x/a.mp3', durationSec: 60, language: 'vi' })
          .catch((e: unknown) => e as AiError);
        expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
        const after = callsOf();
        expect(after.primary - before.primary).toBe(1);
        expect(after.fallback - before.fallback).toBe(0);
        expect((await reservationRows(accountId)).map((x) => x.state)).toEqual(['released']);
        expect(await h().fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
        expect(await h().fake.ledger()).toEqual([]);
      });
    });

    it('dự phòng đắt hơn và không đủ ngân sách → AI_BUDGET_EXHAUSTED như hết hạn mức, KHÔNG gọi dự phòng, reserved = 0', async (ctx) => {
      const db = h().db;
      if (db === undefined) {
        ctx.skip();
        return;
      }
      const cheap = await seededModel(CHEAP);
      const pricey = await seededModel(PRICEY);
      const gw = await db.gatewayWith(
        { routes: stubRoutes(cheap, pricey), prices: new DbPriceSource({ ttlMs: 0 }) },
        { providerTimeoutMs: 5_000 },
      );
      await withAccount(async (accountId) => {
        // Còn 100 000 micro-USD: đủ cho ước tính giá rẻ (~vài nghìn), không đủ cho giá đắt gấp 1000 lần.
        await h().fake.setBudget({ used: CAP - 100_000 });
        const before = callsOf();
        await h().fake.script([{ fail: 'error' }], 'primary');
        const err = await gw.generate(req()).catch((e: unknown) => e as AiError);
        expect((err as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
        const after = callsOf();
        expect(after.primary - before.primary).toBe(1);
        expect(after.fallback - before.fallback).toBe(0);
        expect((await reservationRows(accountId)).map((x) => x.state)).toEqual(['released']);
        expect(await h().fake.getBudget()).toMatchObject({ used: CAP - 100_000, reserved: 0 });
        expect(await h().fake.ledger()).toEqual([]);
      });
    });

    it('lượt dự phòng thiếu giá → BỎ lượt dự phòng: AI_PROVIDER_UNAVAILABLE + ai.price_missing, không gọi dự phòng, không giữ chỗ thứ hai', async (ctx) => {
      const db = h().db;
      if (db === undefined) {
        ctx.skip();
        return;
      }
      const cheap = await seededModel(CHEAP);
      const noPrice = await seededModel(null);
      const gw = await db.gatewayWith(
        { routes: stubRoutes(cheap, noPrice), prices: new DbPriceSource({ ttlMs: 0 }) },
        { providerTimeoutMs: 5_000 },
      );
      await withAccount(async (accountId) => {
        const before = callsOf();
        await h().fake.script([{ fail: 'error' }], 'primary');
        const err = await gw.generate(req()).catch((e: unknown) => e as AiError);
        // Lượt chính đã thất bại → lỗi nhà cung cấp (KHÔNG phải AI_NOT_CONFIGURED).
        expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
        const after = callsOf();
        expect(after.primary - before.primary).toBe(1);
        expect(after.fallback - before.fallback).toBe(0);
        expect((await reservationRows(accountId)).map((x) => x.state)).toEqual(['released']);
        expect(await h().fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
        expect(h().logText()).toContain('ai.price_missing');
      });
    });
  });

  describe('19. chuyển giọng nói theo phút (015 US5, FR-021, SC-009)', () => {
    // Chi tiết làm tròn theo billing_granularity_sec / audioSeconds / missing_usage nằm ở test/ai_gateway/stt.db.spec.ts
    // (cần bảng giá thật + nhà cung cấp viết tay). Ở đây: quy tắc chung cho cả ba kho.
    const stt = (durationSec: number, requestId?: string) => ({
      audioUrl: 'https://x/a.mp3',
      durationSec,
      language: 'vi' as const,
      ...(requestId !== undefined ? { requestId } : {}),
    });

    it('90 s, 300 s, 720 s → ước tính 9 000, 30 000, 30 000 (min(thời lượng, 300 s) × đơn giá/phút)', async () => {
      await withAccount(async () => {
        const g = h().gateway();
        for (const d of [90, 300, 720]) await g.transcribe(stt(d));
        expect((await h().fake.ledger()).map((l) => l.estimateMicroUsd)).toEqual([
          9_000, 30_000, 30_000,
        ]);
      });
    });

    it('chi phí thực ≤ ước tính ở mọi dòng sổ; reserved = 0 sau khi quyết toán', async () => {
      await withAccount(async () => {
        const g = h().gateway();
        for (const d of [90, 300, 720]) await g.transcribe(stt(d));
        for (const l of await h().fake.ledger()) {
          expect(l.costMicroUsd).toBeLessThanOrEqual(l.estimateMicroUsd);
          expect(l.modelTier).toBe('stt');
        }
        expect((await h().fake.getBudget()).reserved).toBe(0);
      });
    });

    it('không đọc được âm thanh (cả hai lượt lỗi) → release, không dòng sổ, không phí', async () => {
      await withAccount(async () => {
        const g = h().gateway();
        await h().fake.script([{ fail: 'error' }], 'primary');
        await h().fake.script([{ fail: 'error' }], 'fallback');
        const err = await g.transcribe(stt(120)).catch((e: unknown) => e);
        expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
        expect(await h().fake.ledger()).toEqual([]);
        expect(await h().fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
        expect((await h().fake.reservations()).every((r) => r.state === 'released')).toBe(true);
      });
    });

    it('ngân sách cạn → AI_BUDGET_EXHAUSTED trước khi gọi nhà cung cấp (0 lời gọi)', async () => {
      await withAccount(async () => {
        const g = h().gateway();
        await h().fake.setBudget({ used: CAP });
        const calls = h().bundle.primary.calls.length + h().bundle.fallback.calls.length;
        const err = await g.transcribe(stt(90)).catch((e: unknown) => e);
        expect((err as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
        expect(h().bundle.primary.calls.length + h().bundle.fallback.calls.length).toBe(calls);
      });
    });

    it('requestId media:{mediaId}:label lần hai → AI_DUPLICATE_REQUEST(settled), 0 lời gọi thêm, đúng 1 dòng sổ', async (ctx) => {
      if (!h().supportsRequestId) {
        ctx.skip();
        return;
      }
      await withAccount(async () => {
        const g = h().gateway();
        const id = `media:${crypto.randomUUID()}:label`;
        await g.transcribe(stt(90, id));
        const calls = h().bundle.primary.calls.length + h().bundle.fallback.calls.length;
        const err = await g.transcribe(stt(90, id)).catch((e: unknown) => e);
        expect((err as AiError).code).toBe('AI_DUPLICATE_REQUEST');
        expect((err as AiError).status).toBe('settled');
        expect(h().bundle.primary.calls.length + h().bundle.fallback.calls.length).toBe(calls);
        expect(await h().fake.ledger()).toHaveLength(1);
      });
    });
  });

  describe('20. ngân sách hệ thống theo ngành (015 US7, FR-032/032a, SC-014)', () => {
    // Quy tắc chung cho cả ba kho (ngữ cảnh, hết trần, không chạm khách, tuần UTC+7) + các ca RIÊNG kho `db` về trần
    // = số ngành × mức/ngành chụp lúc tạo (chi tiết ở test/ai_gateway/system-budget.db.spec.ts). Phần phân bổ chia đều
    // (FR-033) nằm ở test/ai_gateway/allocation.db.spec.ts – tổng bằng chi phí, `used` khách không đổi.
    const SYS_INDUSTRY = '01900000-0000-7000-8000-000000000001';
    const sysReq = () => ({
      ...req({ task: 'trend_summary' }),
      task: 'trend_summary' as const,
      industryId: SYS_INDUSTRY,
    });
    const providerCalls = () => h().bundle.primary.calls.length + h().bundle.fallback.calls.length;
    const occurrences = (needle: string) => h().logText().split(needle).length - 1;
    const systemUsage = (w: string) =>
      h().inSystem(() => h().bundle.store.usage({ scope: 'system', weekStart: w }));

    /** Tuần dùng giờ giả (chỉ `Date`) → dòng tuần của ca này nằm xa dữ liệu thật; dọn sau ca. */
    async function dropSystemWeeks(weeks: string[]): Promise<void> {
      await h().inSystem(() => h().bundle.store.reset());
      if (h().mode !== 'db') return;
      await asOwner(async (c) => {
        for (const table of ['system_cost_ledger', 'system_reservations', 'system_budgets']) {
          await c.query(`DELETE FROM ai_gateway.${table} WHERE week_start = ANY($1::date[])`, [
            weeks,
          ]);
        }
      });
    }
    const sysOverrides = (industries: number, perIndustryWeekly: number): Partial<DbStoreOptions> =>
      ({
        settings: new AiSettings({
          ttlMs: 0,
          load: () =>
            Promise.resolve({ accountCap: 4_000_000, softLimit: 2_000_000, perIndustryWeekly }),
        }),
        activeIndustries: { countActiveIndustries: () => Promise.resolve(industries) },
      }) as unknown as Partial<DbStoreOptions>;

    it('ngữ cảnh tài khoản gọi system.generate → bị từ chối; không giữ chỗ, không sổ, không gọi nhà cung cấp, mức dùng của khách giữ nguyên', async () => {
      const accountId = await h().newAccount();
      const g = h().gateway();
      const reservationsBefore = await h().inSystem(
        async () => (await h().fake.reservations()).length,
      );
      const callsBefore = providerCalls();
      await h().inAccount(accountId, async () => {
        await h().fake.setBudget({ used: 50_000, ...cycleOverride('2026-11-01') });
        const usage = await g.getUsage();
        const budget = await h().fake.getBudget();
        await expect(g.system.generate(sysReq())).rejects.toBeInstanceOf(
          SystemContextRequiredError,
        );
        expect(await g.getUsage()).toEqual(usage);
        expect(await h().fake.getBudget()).toEqual(budget);
        expect(await h().fake.ledger()).toEqual([]);
      });
      expect(await h().inSystem(async () => (await h().fake.reservations()).length)).toBe(
        reservationsBefore,
      );
      expect(providerCalls()).toBe(callsBefore);
    });

    it('việc hệ thống chạy ngoài ngữ cảnh tài khoản trừ ngân sách hệ thống, KHÔNG đổi used/reserved/cap/cờ hay % của khách', async () => {
      const accountId = await h().newAccount();
      const g = h().gateway();
      const customer = () =>
        h().inAccount(accountId, async () => ({
          budget: await h().fake.getBudget(),
          usage: await g.getUsage(),
        }));
      await h().inAccount(accountId, () =>
        h().fake.setBudget({ used: 1_234_000, ...cycleOverride('2026-11-01') }),
      );
      const before = await customer();
      await h().inSystem(async () => {
        await h().bundle.store.setSystemBudget({ used: 0, reserved: 0, cap: 2_000_000 });
        const r = await g.system.generate(sysReq());
        expect(r.modelTier).toBe('cheap');
        const sys = await h().bundle.store.usage({ scope: 'system', weekStart: weekStart() });
        expect(sys.used).toBeGreaterThan(0); // đã trừ ngân sách hệ thống
        expect(sys.reserved).toBe(0);
        await h().bundle.store.setSystemBudget({ used: 0, reserved: 0 });
      });
      expect(await customer()).toEqual(before);
    });

    it('hết trần tuần → AI_SYSTEM_BUDGET_EXHAUSTED + sự kiện ai.system_budget_exhausted; 0 lời gọi nhà cung cấp, không rò giữ chỗ, không dòng sổ mới', async () => {
      const g = h().gateway();
      await h().inSystem(async () => {
        const store = h().bundle.store;
        await store.setSystemBudget({ used: 0, reserved: 0, cap: 2_000_000 });
        await store.setSystemBudget({ used: 2_000_000 });
        const calls = providerCalls();
        const events = occurrences('ai.system_budget_exhausted');
        const ledgerBefore = (await h().fake.ledger()).length;
        const err = await g.system.generate(sysReq()).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AiError);
        expect((err as AiError).code).toBe('AI_SYSTEM_BUDGET_EXHAUSTED');
        expect(providerCalls()).toBe(calls);
        expect(occurrences('ai.system_budget_exhausted')).toBeGreaterThan(events);
        expect(await store.usage({ scope: 'system', weekStart: weekStart() })).toMatchObject({
          used: 2_000_000,
          reserved: 0,
        });
        expect((await h().fake.ledger()).length).toBe(ledgerBefore);
        await store.setSystemBudget({ used: 0, reserved: 0 });
      });
    });

    it('tuần bắt đầu thứ Hai 00:00 UTC+7: 23:59:59 Chủ nhật còn tuần cũ, 00:00 thứ Hai sang tuần mới', async () => {
      const g = h().gateway();
      const prev = '2041-03-04';
      const next = '2041-03-11';
      try {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2041-03-10T16:59:59Z')); // Chủ nhật 23:59:59 UTC+7
        await h().inSystem(() => g.system.generate(sysReq()));
        const usedPrev = (await systemUsage(prev)).used;
        expect(usedPrev).toBeGreaterThan(0);
        expect((await systemUsage(next)).used).toBe(0);

        vi.setSystemTime(new Date('2041-03-10T17:00:00Z')); // thứ Hai 00:00 UTC+7
        await h().inSystem(() => g.system.generate(sysReq()));
        expect((await systemUsage(next)).used).toBeGreaterThan(0);
        expect((await systemUsage(prev)).used).toBe(usedPrev);
      } finally {
        vi.useRealTimers();
        await dropSystemWeeks([prev, next]);
      }
    });

    it('kho db: trần tuần = số ngành đang hoạt động × mức/ngành, CHỤP lúc tạo dòng tuần (đổi số ngành sau đó không đổi trần)', async (ctx) => {
      const db = h().db;
      if (db === undefined) {
        ctx.skip();
        return;
      }
      const w = '2041-03-25'; // thứ Hai; giờ giả rơi vào thứ Tư của tuần này
      const row = () =>
        asOwner(async (c) => {
          const r = await c.query<{ cap: string; industry_count: number; per: string }>(
            `SELECT cap::text, industry_count, per_industry_micro_usd::text AS per
               FROM ai_gateway.system_budgets WHERE week_start = $1::date`,
            [w],
          );
          return r.rows[0];
        });
      try {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2041-03-27T05:00:00Z'));
        const three = await db.gatewayWith(sysOverrides(3, 150_000));
        await h().inSystem(() => three.system.generate(sysReq()));
        expect(await row()).toEqual({ cap: '450000', industry_count: 3, per: '150000' });

        const nine = await db.gatewayWith(sysOverrides(9, 1_000_000));
        await h().inSystem(() => nine.system.generate(sysReq()));
        expect(await row()).toEqual({ cap: '450000', industry_count: 3, per: '150000' });
      } finally {
        vi.useRealTimers();
        await dropSystemWeeks([w]);
      }
    });

    it('kho db: trần tuần nhỏ (1 ngành × 1 micro-USD) → AI_SYSTEM_BUDGET_EXHAUSTED ngay, không gọi nhà cung cấp, vẫn ghi sự kiện cảnh báo', async (ctx) => {
      const db = h().db;
      if (db === undefined) {
        ctx.skip();
        return;
      }
      const w = '2041-04-01'; // thứ Hai
      try {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2041-04-03T05:00:00Z'));
        const tiny = await db.gatewayWith(sysOverrides(1, 1));
        const calls = providerCalls();
        const events = occurrences('ai.system_budget_exhausted');
        const err = await h()
          .inSystem(() => tiny.system.generate(sysReq()))
          .catch((e: unknown) => e);
        expect((err as AiError).code).toBe('AI_SYSTEM_BUDGET_EXHAUSTED');
        expect(providerCalls()).toBe(calls);
        expect(occurrences('ai.system_budget_exhausted')).toBeGreaterThan(events);
        const sys = await systemUsage(w);
        expect(sys).toMatchObject({ used: 0, reserved: 0 });
      } finally {
        vi.useRealTimers();
        await dropSystemWeeks([w]);
      }
    });
  });

  describe('nhật ký', () => {
    it('không chứa lời nhắc, văn bản kết quả hay số tiền', () => {
      const logs = h().logText();
      expect(logs).toContain('ai_gateway.generate');
      expect(logs).not.toContain('PROMPT_CANARY_');
      expect(logs).not.toContain('[fake:');
      expect(logs).not.toMatch(/micro_usd|costMicroUsd/i);
    });
  });
}
