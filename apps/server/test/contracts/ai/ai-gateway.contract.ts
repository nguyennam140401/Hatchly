import { describe, expect, it } from 'vitest';
import { AiError, type AiRequest } from '../../../src/modules/ai_gateway';
import { SystemContextRequiredError } from '../../../src/modules/ai_gateway/internal/errors';
import type { AiHarness } from './harness';

// Bộ kiểm thử hợp đồng Cổng AI (005, contracts/ai-gateway.md mục 5). Chạy với `memory` (pnpm test) và
// `sandbox` (pnpm test:db). Bất biến: used + reserved <= cap ở MỌI thời điểm quan sát.

const CAP = 4_000_000;
const req = (over: Partial<AiRequest> = {}): AiRequest => ({
  task: 'post_generation',
  prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'PROMPT_CANARY_1 Viết bài khai trương quán cà phê.' },
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
          provider: 'primary',
          inputTokens: r.usage.inputTokens,
          outputTokens: r.usage.outputTokens,
          anomaly: null,
          overCapMicroUsd: 0,
        });
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
        expect((err as AiError).messageVi).toBe('Đã sử dụng hết giới hạn AI của chu kỳ');
        expect((err as AiError).messageVi).not.toMatch(/\d|\$|USD/);
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
          const s = await store.usage({ scope: 'account', cycleStart: await store.currentCycleStart() });
          if (s.used + s.reserved > s.cap || s.reserved < 0) violations++;
        };
        const wrap = <K extends 'reserve' | 'release' | 'settle' | 'markCalling'>(k: K) => {
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
          (await g.generate(req({ task: 'image_labeling', images: [{ url: 'https://x/1.jpg', bytes: 1 }] }))).modelTier,
        ).toBe('cheap_vision');
        expect((await g.generate(req({ task: 'video_labeling' }))).modelTier).toBe('cheap_vision');
        expect((await g.transcribe({ audioUrl: 'https://x/a.mp3', durationSec: 10, language: 'vi' })).modelTier).toBe('stt');
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
        expect((await h().fake.ledger()).map((l) => l.provider)).toEqual(['fallback']);
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
        expect((await h().fake.reservations()).map((r) => r.state)).toEqual(['released', 'released']);
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
        setTimeout(() => s.cancel(), 50);
        for await (const _ of s) {
          // không có chữ nào
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
        await h().fake.setBudget({ used: 2_000_000, cap: 2_000_100 });
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
        const held = await store.reserve(key, 1_000, { task: 'post_generation', modelTier: 'default' });
        const calling = await store.reserve(key, 5_000, { task: 'post_generation', modelTier: 'default' });
        if (!held.ok || !calling.ok) throw new Error('giữ chỗ phải thành công');
        await store.markCalling(calling.reservationId); // nhà cung cấp đã nhận, tiến trình "chết" trước settle
        const fresh = await store.reserve(key, 7, { task: 'post_generation', modelTier: 'default' });
        await h().fake.ageReservations(16 * 60_000);
        if (fresh.ok) await store.release(fresh.reservationId);
        const fresh2 = await store.reserve(key, 9, { task: 'post_generation', modelTier: 'default' });

        expect(await store.releaseStale(15 * 60_000)).toEqual({ released: 1, settledAtEstimate: 1 });
        const b = await h().fake.getBudget();
        expect(b.used).toBe(5_000);
        expect(b.reserved).toBe(9); // giữ chỗ < 15 phút không bị đụng
        const ledger = await h().fake.ledger();
        expect(ledger).toHaveLength(1);
        expect(ledger[0]).toMatchObject({ anomaly: 'unsettled', costMicroUsd: 5_000, inputTokens: 0, outputTokens: 0 });

        expect(await store.releaseStale(15 * 60_000)).toEqual({ released: 0, settledAtEstimate: 0 });
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
      const sys = { ...req({ task: 'trend_summary' }), task: 'trend_summary' as const, industryId: '01900000-0000-7000-8000-000000000001' };
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
