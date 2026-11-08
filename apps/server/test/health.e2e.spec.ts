import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ErrorResponse, HealthResponse } from '@app/shared/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiAppModule } from '../src/app/api-app.module';
import { configureApiApp } from '../src/app/configure-api-app';
import { loadConfig } from '../src/core/config/load-config';
import { WorkerHealthServer } from '../src/core/health/worker-health-server';
import { ShutdownCoordinator } from '../src/core/lifecycle/shutdown-coordinator';

describe('API /healthz, /readyz', () => {
  let app: INestApplication;
  const config = loadConfig({
    APP_ENV: 'test',
    APP_VERSION: '1.2.3-test',
    LOG_LEVEL: 'fatal',
    // Cổng 1 không mở → CSDL "chưa sẵn sàng"; ca CSDL sẵn sàng ở test/db/readiness.db.spec.ts.
    DATABASE_APP_URL: 'postgres://app:x@127.0.0.1:1/app',
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ApiAppModule.forRoot(config)],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApiApp(app, config);
    await app.init();
    app.get(ShutdownCoordinator).markReady();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /healthz → 200 HealthResponse unit "api"', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/healthz')
      .expect(200);
    const body = HealthResponse.parse(res.body);
    expect(body.unit).toBe('api');
    expect(body.version).toBe('1.2.3-test');
    expect(Object.keys(res.body as object).sort()).toEqual(['status', 'time', 'unit', 'version']);
    expect(res.headers['x-trace-id']).toBeTruthy();
  });

  it('GET /readyz khi CSDL không kết nối được → 503, support.detail nêu database (+ queue – 003)', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/readyz')
      .expect(503);
    const body = ErrorResponse.parse(res.body);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    // Bộ tạo việc của API (003) cũng chưa khởi động được khi không có CSDL.
    expect(body.error.support.detail).toBe('checks_failed:database,queue');
  });

  it('đường dẫn lạ → 404 NOT_FOUND có hành động khắc phục, traceId trùng tiêu đề', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/khong-ton-tai')
      .expect(404);
    const body = ErrorResponse.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.actions.length).toBeGreaterThanOrEqual(1);
    expect(body.error.support.traceId).toBe(res.headers['x-trace-id']);
  });

  it('dùng lại x-trace-id hợp lệ từ ingress, bỏ giá trị không hợp lệ', async () => {
    const incoming = '0190a0b4-6b5e-7c3a-8f4e-1a2b3c4d5e6f';
    const ok = await request(app.getHttpServer() as Server)
      .get('/healthz')
      .set('x-trace-id', incoming);
    expect(ok.headers['x-trace-id']).toBe(incoming);
    const bad = await request(app.getHttpServer() as Server)
      .get('/healthz')
      .set('x-trace-id', '<script>');
    expect(bad.headers['x-trace-id']).not.toBe('<script>');
  });

  it('khi đang dừng → /readyz 503 SERVICE_UNAVAILABLE', async () => {
    await app.get(ShutdownCoordinator).beforeApplicationShutdown('SIGTERM');
    const res = await request(app.getHttpServer() as Server)
      .get('/readyz')
      .expect(503);
    const body = ErrorResponse.parse(res.body);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.error.actions[0]?.kind).toBe('retry');
    expect(body.error.support.traceId).toBe(res.headers['x-trace-id']);
  });
});

describe('Worker /healthz, /readyz (003 FR-019)', () => {
  const checks: { name: string; status: 'pass' | 'fail' }[] = [];
  let state: 'ready' | 'stopping' = 'ready';
  const server = new WorkerHealthServer({
    version: '1.2.3-test',
    getState: () => state,
    readiness: { run: () => Promise.resolve([...checks]) },
  });

  beforeAll(async () => {
    await server.listen(0);
  });
  afterAll(async () => {
    await server.close();
  });

  const get = (path: string) => fetch(`http://127.0.0.1:${server.port}${path}`);

  it('mọi kiểm tra đạt → /readyz 200 { status: ready, checks }; /healthz vẫn 200', async () => {
    checks.splice(
      0,
      checks.length,
      { name: 'database', status: 'pass' },
      { name: 'queue', status: 'pass' },
    );
    const res = await get('/readyz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready', checks });
    expect((await get('/healthz')).status).toBe(200);
  });

  it('một kiểm tra fail → /readyz 503 nêu tên kiểm tra; /healthz vẫn 200 (tiến trình sống)', async () => {
    checks.splice(
      0,
      checks.length,
      { name: 'database', status: 'pass' },
      { name: 'queue', status: 'fail' },
    );
    const res = await get('/readyz');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      status: 'not_ready',
      checks: [{}, { name: 'queue', status: 'fail' }],
    });
    expect((await get('/healthz')).status).toBe(200);
  });

  it('đang tắt → cả hai 503; đường dẫn khác → 404', async () => {
    state = 'stopping';
    expect((await get('/readyz')).status).toBe(503);
    expect((await get('/healthz')).status).toBe(503);
    expect((await get('/other')).status).toBe(404);
    state = 'ready';
  });
});
