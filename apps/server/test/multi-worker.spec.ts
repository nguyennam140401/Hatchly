import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getJson, startNode, waitForHttp, type RunningProcess } from './helpers/processes';

// SC-009: 1 API + 2 Worker chạy song song từ cùng bản build; dừng một Worker không ảnh hưởng phần còn lại.
const API_PORT = 34_300;
const W1_PORT = 34_301;
const W2_PORT = 34_302;

describe('Nhiều Worker song song với API', () => {
  let api: RunningProcess;
  let w1: RunningProcess;
  let w2: RunningProcess;

  beforeAll(async () => {
    const env = { APP_ENV: 'test', LOG_LEVEL: 'info', API_PORT: String(API_PORT) };
    api = startNode(['dist/api.js'], env);
    w1 = startNode(['dist/worker.js'], { ...env, WORKER_HEALTH_PORT: String(W1_PORT) });
    w2 = startNode(['dist/worker.js'], { ...env, WORKER_HEALTH_PORT: String(W2_PORT) });
    await Promise.all([
      api.waitForLog('api.ready'),
      w1.waitForLog('worker.ready'),
      w2.waitForLog('worker.ready'),
    ]);
  });

  afterAll(async () => {
    for (const p of [api, w1, w2]) {
      if (p.child.exitCode === null && p.child.signalCode === null) {
        p.child.kill();
        await p.waitForExit();
      }
    }
  });

  it('cả ba /healthz trả 200 đúng unit', async () => {
    const [a, b, c] = await Promise.all([
      getJson(`http://127.0.0.1:${API_PORT}/healthz`),
      getJson(`http://127.0.0.1:${W1_PORT}/healthz`),
      getJson(`http://127.0.0.1:${W2_PORT}/healthz`),
    ]);
    expect(a).toMatchObject({ status: 200, body: { unit: 'api' } });
    expect(b).toMatchObject({ status: 200, body: { unit: 'worker' } });
    expect(c).toMatchObject({ status: 200, body: { unit: 'worker' } });
  });

  it('Worker không mở đường dẫn nghiệp vụ nào', async () => {
    const res = await fetch(`http://127.0.0.1:${W1_PORT}/api/v1/diagnostics/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(404);
    expect((await getJson(`http://127.0.0.1:${W1_PORT}/readyz`)).status).toBe(404);
  });

  it('dừng một Worker không ảnh hưởng Worker còn lại và API', async () => {
    w2.child.kill();
    await w2.waitForExit();
    await expect(waitForHttp(`http://127.0.0.1:${W2_PORT}/healthz`, 300)).rejects.toThrow();
    expect((await getJson(`http://127.0.0.1:${W1_PORT}/healthz`)).status).toBe(200);
    expect((await getJson(`http://127.0.0.1:${API_PORT}/healthz`)).status).toBe(200);
  });
});
