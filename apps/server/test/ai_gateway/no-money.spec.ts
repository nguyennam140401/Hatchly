import type { NotificationEvent } from '@app/shared/notifications';
import { beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import type { AiRequest } from '../../src/modules/ai_gateway';
import { makeOnCrossed } from '../../src/modules/ai_gateway/ai_gateway.module';
import { deliverNotification } from '../../src/modules/notifications/internal/deliver.handler';
import { getMemoryEmitter } from '../../src/modules/notifications/internal/fake';
import { MemoryNotificationStore } from '../../src/modules/notifications/internal/fake/store.memory';
import { makeAiHarness, type AiHarness } from '../contracts/ai/harness';

// 015 US6 (T054; FR-029, FR-030, SC-004; hiến chương III): KHÔNG số tiền ở bất kỳ nơi nào khách thấy.
// Quét đệ quy ba bề mặt: `getUsage()`, sự kiện/thông báo `ai_usage_80|100` (payload + nội dung hiển thị) và email mẫu.
// Chỉ phần trăm, làm tròn XUỐNG. Đỏ tạm tới khi T056 nếu `getUsage()` lộ thêm trường (hiện kỳ vọng khớp 005).
// Chạy bằng kho bộ nhớ (pnpm test); phần CSDL thật của getUsage đã được hợp đồng mục 8 kiểm trên cả ba kho.

const KEY_MONEY = /usd|micro|cost|amount|price|money|\bcents?\b|chi_?phi|gia_?tien|dong|vnd/i;
// Chuỗi chứa ký hiệu/đơn vị tiền hoặc số có dấu phân cách hàng nghìn/phần thập phân kiểu tiền.
const TEXT_MONEY = /\$|\busd\b|micro|₫|\bvnd\b|\bđồng\b|\d[.,]\d{2,3}\b/i;

function scan(value: unknown, path: string, errors: string[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (TEXT_MONEY.test(value)) errors.push(`chuỗi tiền ở ${path}: ${value.slice(0, 40)}`);
    return;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    // Số duy nhất được phép: phần trăm nguyên 0–100.
    if (typeof value === 'bigint' || !Number.isInteger(value) || value < 0 || value > 100) {
      errors.push(`số không phải phần trăm ở ${path}: ${String(value)}`);
    }
    return;
  }
  if (value instanceof Date) return;
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (KEY_MONEY.test(k)) errors.push(`khóa tiền tệ ${path}.${k}`);
      scan(v, `${path}.${k}`, errors);
    }
  }
}

const req = (): AiRequest => ({
  task: 'post_generation',
  prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'Viết bài khai trương.' },
  maxOutputTokens: 40,
});

describe('Cổng AI – không lộ số tiền cho khách (US6, SC-004)', () => {
  let h: AiHarness;
  const emitter = getMemoryEmitter();
  beforeAll(async () => {
    h = await makeAiHarness('memory', () => Promise.resolve(uuidV7()), {
      onCrossed: () => Promise.resolve(),
      count: () => Promise.resolve(0),
    });
  });

  const inAccount = async <T>(fn: () => Promise<T>): Promise<T> => h.inAccount(uuidV7(), fn);

  describe('getUsage()', () => {
    it('chỉ có {percent, state, nextCycleStartsAt}; không khóa/giá trị tiền ở mọi mức dùng', async () => {
      await inAccount(async () => {
        const g = h.gateway();
        for (const used of [
          0, 1_234_567, 1_999_999, 2_000_000, 3_199_999, 3_200_000, 3_999_999, 4_000_000,
        ]) {
          await h.fake.setBudget({ used, reserved: 0 });
          const u = await g.getUsage();
          const errors: string[] = [];
          scan(u, 'usage', errors);
          expect(errors, `used=${used}`).toEqual([]);
          expect(Object.keys(u).sort()).toEqual(['nextCycleStartsAt', 'percent', 'state']);
        }
      });
    });

    it('phần trăm làm tròn XUỐNG: 3 999 999/4 000 000 → 99 (không phải 100); 1 234 567 → 30', async () => {
      await inAccount(async () => {
        const g = h.gateway();
        await h.fake.setBudget({ used: 3_999_999, reserved: 0 });
        expect((await g.getUsage()).percent).toBe(99);
        await h.fake.setBudget({ used: 1_234_567, reserved: 0 });
        expect((await g.getUsage()).percent).toBe(30);
        await h.fake.setBudget({ used: 3_199_999, reserved: 0 });
        expect((await g.getUsage()).percent).toBe(79);
        await h.fake.setBudget({ used: 3_200_000, reserved: 0 });
        expect((await g.getUsage()).percent).toBe(80);
      });
    });
  });

  describe('thông báo ai_usage_80 / ai_usage_100', () => {
    function eventsOf(): NotificationEvent[] {
      return emitter.drain().map((p) => p.event);
    }

    it('sự kiện do cổng phát (payload) chỉ mang cycleStart + percent', async () => {
      await inAccount(async () => {
        emitter.drain();
        const g = h.gateway({
          onCrossed: (tx, crossed, cycle) => makeOnCrossed(emitter)(tx, crossed, cycle),
        });
        await h.fake.setBudget({ used: 3_199_000, cycleStart: '2026-11-01' });
        await h.fake.script([{ actualCostMultiplier: 40, outputTokens: 40 }], 'primary');
        await g.generate(req());
        await h.fake.setBudget({ used: 3_999_000 });
        await h.fake.script([{ actualCostMultiplier: 100, outputTokens: 40 }], 'primary');
        await g.generate(req());
        const events = eventsOf();
        expect(events.map((e) => e.type).sort()).toEqual(['ai_usage_100', 'ai_usage_80']);
        for (const e of events) {
          const copy = JSON.parse(JSON.stringify(e)) as Record<string, unknown>;
          // Ngày chu kỳ nằm ở refs: bỏ khỏi phép quét "số" vì là chuỗi ngày hợp lệ.
          delete copy.refs;
          const errors: string[] = [];
          scan(copy, 'event', errors);
          expect(errors).toEqual([]);
          expect(Object.keys(e.refs as Record<string, unknown>)).toEqual(['cycleStart']);
          expect(Object.keys((e.params ?? {}) as Record<string, unknown>)).toEqual(['percent']);
        }
      });
    });

    for (const type of ['ai_usage_80', 'ai_usage_100'] as const) {
      it(`${type}: tiêu đề, nội dung, hành động và email mẫu không chứa số tiền, đơn giá hay chi phí`, async () => {
        await inAccount(async () => {
          const store = new MemoryNotificationStore();
          const sent: { to: string; subject: string; text: string; html: string }[] = [];
          await deliverNotification(
            {
              type,
              refs: { cycleStart: '2026-11-01' },
              params: { percent: type === 'ai_usage_80' ? 80 : 100 },
            },
            {
              store,
              webBaseUrl: 'https://app.example',
              members: {
                listActiveMembers: () =>
                  Promise.resolve([
                    {
                      userId: uuidV7(),
                      role: 'owner' as const,
                      email: 'chu@example.test',
                      displayName: 'Chủ cửa hàng',
                    },
                  ]),
              },
              mailer: {
                deliver: (m: { to: string; subject: string; text: string; html: string }) => {
                  sent.push(m);
                  return Promise.resolve({ kind: 'sent' as const });
                },
              } as never,
            },
          );
          const delivered = await store.delivered({ type });
          expect(delivered.length).toBeGreaterThan(0);
          expect(sent).toHaveLength(1);
          const errors: string[] = [];
          for (const d of delivered) {
            scan({ titleVi: d.titleVi, bodyVi: d.bodyVi }, 'inapp', errors);
            for (const a of d.actions) scan({ labelVi: a.labelVi }, 'action', errors);
          }
          scan(
            { subject: sent[0]!.subject, text: sent[0]!.text.replace(/https?:\S+/g, '') },
            'email',
            errors,
          );
          scan(
            { html: sent[0]!.html.replace(/https?:\S+/g, '').replace(/<[^>]+>/g, ' ') },
            'email-html',
            errors,
          );
          expect(errors).toEqual([]);
          const all = `${sent[0]!.subject}\n${sent[0]!.text}\n${sent[0]!.html}`;
          expect(all).not.toMatch(/\$|usd|micro|₫|\bđồng\b/i);
          // Có hành động khắc phục (hiến chương VI).
          expect(delivered.every((d) => d.actions.length >= 1)).toBe(true);
        });
      });
    }
  });
});
