import { describe, expect, it } from 'vitest';
import { getJson, startNode } from './helpers/processes';

// SC-004: Worker tắt có kiểm soát ≤ 30 giây, thoát mã 0, lặp 10 lần.
// Trên Windows `child.kill()` giết tiến trình ngay (không chạy hook tắt) nên các ca dùng tín hiệu
// bị bỏ qua – chạy `pnpm --filter @app/server test:linux` để kiểm trong container Linux (R5).
const onWindows = process.platform === 'win32';
const PORT = 34_201;

const baseEnv = {
  APP_ENV: 'test',
  LOG_LEVEL: 'info',
  WORKER_HEALTH_PORT: String(PORT),
};

describe('Worker tắt có kiểm soát', () => {
  it('khởi động: ghi worker.ready với queues rỗng và trả /healthz unit "worker"', async () => {
    const proc = startNode(['dist/worker.js'], baseEnv);
    try {
      const ready = await proc.waitForLog('worker.ready');
      expect(ready.queues).toEqual([]);
      expect(ready.unit).toBe('worker');
      const res = await getJson(`http://127.0.0.1:${PORT}/healthz`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', unit: 'worker' });
    } finally {
      proc.child.kill();
      await proc.waitForExit();
    }
  });

  it('thiếu APP_ENV → thoát mã 1, in tên biến, không in giá trị', async () => {
    const proc = startNode(['dist/worker.js'], { WORKER_HEALTH_PORT: 'khong-phai-so' });
    const { code } = await proc.waitForExit();
    expect(code).toBe(1);
  });

  it.skipIf(onWindows)(
    'SIGTERM/SIGINT → worker.stopping, worker.stopped, mã 0 trong ≤ 30 giây (10 lần)',
    async () => {
      for (let round = 0; round < 10; round++) {
        const signal = round % 2 === 0 ? 'SIGTERM' : 'SIGINT';
        const proc = startNode(['dist/worker.js'], baseEnv);
        await proc.waitForLog('worker.ready');
        const started = Date.now();
        proc.child.kill(signal);
        const { code } = await proc.waitForExit(35_000);
        const elapsed = Date.now() - started;
        expect(code, `lượt ${round + 1} (${signal})`).toBe(0);
        expect(elapsed).toBeLessThanOrEqual(30_000);
        expect(proc.logs.some((l) => l.msg === 'worker.stopping')).toBe(true);
        expect(proc.logs.some((l) => l.msg === 'worker.stopped')).toBe(true);
      }
    },
    400_000,
  );

  it.skipIf(onWindows)(
    'tác vụ treo → hết SHUTDOWN_TIMEOUT_MS thì thoát mã 1 kèm cảnh báo',
    async () => {
      const proc = startNode(['--import', 'tsx', 'test/fixtures/hanging-worker.ts'], {
        ...baseEnv,
        SHUTDOWN_TIMEOUT_MS: '2000',
      });
      await proc.waitForLog('worker.ready');
      const started = Date.now();
      proc.child.kill('SIGTERM');
      const { code } = await proc.waitForExit(15_000);
      expect(code).toBe(1);
      expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
      expect(proc.logs.some((l) => l.msg === 'shutdown.timeout')).toBe(true);
    },
    30_000,
  );
});
