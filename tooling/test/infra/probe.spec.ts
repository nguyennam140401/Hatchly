import { describe, expect, it } from 'vitest';
import { probe } from '../../infra/lib/probe.mjs';

// T081: probe đo đúng khoảng gián đoạn dài nhất.

describe('probe', () => {
  it('đo gián đoạn dài nhất theo đồng hồ giả', async () => {
    let clock = 0;
    const results = [true, true, false, false, false, true, false, true, true, true];
    let i = 0;
    const out = await probe({
      url: 'https://x.test/healthz',
      seconds: 10,
      intervalMs: 1000,
      now: () => clock,
      sleep: () => {
        clock += 1000;
        return Promise.resolve();
      },
      fetchImpl: () => Promise.resolve({ ok: results[i++] ?? true } as Response),
    });
    expect(out.samples).toBe(10);
    expect(out.failures).toBe(4);
    expect(out.longestOutageSeconds).toBe(3);
  });
});
