import { TEST_AUTH_ENV, TEST_ORIGIN } from './helpers/auth-env';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EchoRequest, EchoResponse, ErrorResponse, toFieldErrors } from '@app/shared/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiAppModule } from '../src/app/api-app.module';
import { configureApiApp } from '../src/app/configure-api-app';
import { AppConfigSchema } from '../src/core/config/config.schema';
import { loadConfig, loadConfigFrom } from '../src/core/config/load-config';

async function startApi(appEnv: 'test' | 'production'): Promise<INestApplication> {
  // 005: production chưa có bản thật của các cổng (loadConfig từ chối bản giả lập) → dựng từ lược đồ thô.
  const load = appEnv === 'production' ? (env: Record<string, string>) => loadConfigFrom(AppConfigSchema, env) : loadConfig;
  const config = load({
    APP_ENV: appEnv,
    LOG_LEVEL: 'fatal',
    ...TEST_AUTH_ENV,
    // production không nhận MAIL_TRANSPORT=memory (004) – dùng smtp giả (không gửi thư nào).
    ...(appEnv === 'production'
      ? { MAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtp://127.0.0.1:1', MAIL_FROM: 'no-reply@app.test' }
      : {}),
    DATABASE_APP_URL: 'postgres://app:x@127.0.0.1:1/app',
  });
  const moduleRef = await Test.createTestingModule({
    imports: [ApiAppModule.forRoot(config)],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApiApp(app, config);
  await app.init();
  return app;
}

describe('POST /api/v1/diagnostics/echo – kiểm tra đầu vào bằng lược đồ dùng chung', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startApi('test');
  });
  afterAll(async () => {
    await app.close();
  });

  it('{} → 400 VALIDATION_FAILED, fieldErrors tiếng Việt giống hệt web', async () => {
    const res = await request(app.getHttpServer() as Server)
      .post('/api/v1/diagnostics/echo')
      .set('origin', TEST_ORIGIN)
      .send({})
      .expect(400);
    const body = ErrorResponse.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toBe(
      'Thông tin gửi lên chưa đúng. Vui lòng kiểm tra lại các ô được đánh dấu.',
    );
    expect(body.error.actions[0]?.kind).toBe('fix_input');
    expect(body.error.support.detail).toBe('invalid_type');
    expect(body.error.support.traceId).toBe(res.headers['x-trace-id']);

    const paths = body.error.fieldErrors?.map((e) => e.path);
    expect(paths).toContainEqual(['message']);
    expect(paths).toContainEqual(['sentAt']);

    // Cùng kết quả với phía web (EchoRequest.safeParse + toFieldErrors).
    const webSide = toFieldErrors(EchoRequest.safeParse({}).error!);
    expect(body.error.fieldErrors).toEqual(webSide);
    expect(webSide).toContainEqual({ path: ['message'], message: 'Vui lòng nhập nội dung.' });
  });

  it('thân không phải JSON hợp lệ → 400 ErrorResponse', async () => {
    const res = await request(app.getHttpServer() as Server)
      .post('/api/v1/diagnostics/echo')
      .set('origin', TEST_ORIGIN)
      .set('content-type', 'application/json')
      .send('{"message":')
      .expect(400);
    expect(ErrorResponse.parse(res.body).error.code).toBe('VALIDATION_FAILED');
  });

  it('đầu vào hợp lệ → 200 EchoResponse (đã cắt khoảng trắng)', async () => {
    const res = await request(app.getHttpServer() as Server)
      .post('/api/v1/diagnostics/echo')
      .set('origin', TEST_ORIGIN)
      .send({ message: '  xin chào  ', sentAt: '2026-11-08T03:00:00Z' })
      .expect(200);
    const body = EchoResponse.parse(res.body);
    expect(body.message).toBe('xin chào');
  });
});

describe('APP_ENV=production', () => {
  it('không đăng ký điểm chẩn đoán → 404', async () => {
    const app = await startApi('production');
    try {
      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/diagnostics/echo')
        .set('origin', TEST_ORIGIN)
        .send({ message: 'a', sentAt: '2026-11-08T03:00:00Z' })
        .expect(404);
      expect(ErrorResponse.parse(res.body).error.code).toBe('NOT_FOUND');
    } finally {
      await app.close();
    }
  });
});
