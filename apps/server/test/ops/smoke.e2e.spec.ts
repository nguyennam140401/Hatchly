// 008 T067 – điểm cuối kiểm tra khói /ops/smoke (FR-032): bộ gác mã, 202 + GET, giới hạn tần suất, không lộ
// dữ liệu tài khoản. Chạy bằng `pnpm test:db` (API thật trên CSDL thử).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../auth/helpers/app';
import { SMOKE_RATE_LIMIT } from '../../src/modules/queue/internal/smoke/smoke.controller';

const TOKEN = 'smoke-token-for-tests-0123456789';
const PATH = '/api/v1/ops/smoke';

describe('/ops/smoke – có SMOKE_TOKEN', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ env: { SMOKE_TOKEN: TOKEN } });
  });
  afterAll(async () => {
    await t.close();
  });

  const post = (token?: string) => {
    const r = request(t.server).post(PATH);
    return token === undefined ? r : r.set('X-Smoke-Token', token);
  };

  it('thiếu hoặc sai mã → 404 giống đường dẫn không tồn tại', async () => {
    const missing = await post();
    const wrong = await post('sai-ma-sai-ma-sai-ma-sai-ma');
    const unknown = await request(t.server).get('/api/v1/ops/khong-co');
    expect(missing.status).toBe(404);
    expect(wrong.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(Object.keys(missing.body as object).sort()).toEqual(
      Object.keys(unknown.body as object).sort(),
    );
  });

  it('GET với mã sai → 404, dù id có thật', async () => {
    await request(t.server)
      .get(`${PATH}/0190a000-0000-7000-8000-000000000000`)
      .set('X-Smoke-Token', 'sai-ma-sai-ma-sai-ma-sai-ma')
      .expect(404);
  });

  it('đúng mã → 202 { id }, GET trả apiVersion + processedAt null, không chứa dữ liệu tài khoản', async () => {
    let id = '';
    // Bộ tạo việc của API khởi động nền – thử lại ngắn tới khi sẵn sàng.
    for (let i = 0; i < 50 && id === ''; i++) {
      const res = await post(TOKEN);
      if (res.status === 202) id = (res.body as { id: string }).id;
      else await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const res = await request(t.server)
      .get(`${PATH}/${id}`)
      .set('X-Smoke-Token', TOKEN)
      .expect(200);
    expect(res.body).toEqual({
      id,
      requestedAt: expect.any(String) as string,
      apiVersion: expect.any(String) as string,
      processedAt: null,
      workerVersion: null,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/account|email|tenant/i);
  });

  it('id không phải UUID hoặc không có → 404', async () => {
    await request(t.server).get(`${PATH}/khong-phai-uuid`).set('X-Smoke-Token', TOKEN).expect(404);
    await request(t.server)
      .get(`${PATH}/0190a000-0000-7000-8000-000000000001`)
      .set('X-Smoke-Token', TOKEN)
      .expect(404);
  });

  it(`quá ${SMOKE_RATE_LIMIT} yêu cầu tạo mỗi phút → 429`, async () => {
    const statuses: number[] = [];
    for (let i = 0; i < SMOKE_RATE_LIMIT + 2; i++) statuses.push((await post(TOKEN)).status);
    expect(statuses).toContain(429);
  });
});

describe('/ops/smoke – không đặt SMOKE_TOKEN', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('kể cả khi gửi mã → 404', async () => {
    await request(t.server).post(PATH).set('X-Smoke-Token', TOKEN).expect(404);
    await request(t.server)
      .get(`${PATH}/0190a000-0000-7000-8000-000000000000`)
      .set('X-Smoke-Token', TOKEN)
      .expect(404);
  });
});
