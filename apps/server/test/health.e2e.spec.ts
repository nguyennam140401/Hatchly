import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ErrorResponse, HealthResponse, ReadinessResponse } from '@app/shared/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiAppModule } from '../src/app/api-app.module';
import { configureApiApp } from '../src/app/configure-api-app';
import { loadConfig } from '../src/core/config/load-config';
import { ShutdownCoordinator } from '../src/core/lifecycle/shutdown-coordinator';

describe('API /healthz, /readyz', () => {
  let app: INestApplication;
  const config = loadConfig({ APP_ENV: 'test', APP_VERSION: '1.2.3-test', LOG_LEVEL: 'fatal' });

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

  it('GET /readyz → 200 ready, checks rỗng', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/readyz')
      .expect(200);
    expect(ReadinessResponse.parse(res.body)).toEqual({ status: 'ready', checks: [] });
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
