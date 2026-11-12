// 005 T089 (FR-006, R12): route quản trị giả lập + trang ủy quyền giả CHỈ có ở development/test.
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ApiAppModule, shouldRegisterDevRoutes } from '../../src/app/api-app.module';
import { configureApiApp } from '../../src/app/configure-api-app';
import { AppConfigSchema } from '../../src/core/config/config.schema';
import { loadConfig, loadConfigFrom } from '../../src/core/config/load-config';
import { TEST_AUTH_ENV, TEST_ORIGIN } from '../helpers/auth-env';
import { createActors } from '../auth/helpers/actors';
import { createTestApp, type TestApp } from '../auth/helpers/app';
import { describeDb } from '../db/helpers/db';

const DEV_PATHS = [
  ['get', '/api/v1/dev/fakes/scenarios'],
  ['put', '/api/v1/dev/fakes/scenarios'],
  ['delete', '/api/v1/dev/fakes/scenarios'],
  ['get', '/api/v1/dev/fakes/platform/posts'],
  ['get', '/api/v1/dev/fakes/ai/budget'],
  ['post', '/api/v1/dev/fakes/ai/generate'],
  ['post', '/api/v1/dev/fakes/storage/upload-url'],
  ['get', '/api/v1/dev/fakes/notifications'],
  ['get', '/api/v1/dev/fake-oauth/facebook_page/authorize?state=x&redirect_uri=y'],
] as const;

describe('shouldRegisterDevRoutes', () => {
  it('production/staging → false; development/test → true', () => {
    expect(shouldRegisterDevRoutes('production')).toBe(false);
    expect(shouldRegisterDevRoutes('staging')).toBe(false);
    expect(shouldRegisterDevRoutes('development')).toBe(true);
    expect(shouldRegisterDevRoutes('test')).toBe(true);
  });
});

async function startApi(appEnv: 'production' | 'test'): Promise<INestApplication> {
  const env = {
    APP_ENV: appEnv,
    LOG_LEVEL: 'fatal',
    ...TEST_AUTH_ENV,
    MAIL_TRANSPORT: 'smtp',
    SMTP_URL: 'smtp://127.0.0.1:1',
    MAIL_FROM: 'no-reply@app.test',
    DATABASE_APP_URL: 'postgres://app:x@127.0.0.1:1/app',
  };
  // production: chưa có bản thật của các cổng → bỏ qua loadConfig/assertNoFakes, các cổng "chưa cấu hình".
  const config = appEnv === 'production' ? loadConfigFrom(AppConfigSchema, env) : loadConfig(env);
  const moduleRef = await Test.createTestingModule({
    imports: [ApiAppModule.forRoot(config)],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApiApp(app, config);
  await app.init();
  return app;
}

describe('APP_ENV=production', () => {
  let app: INestApplication | undefined;
  afterAll(async () => {
    await app?.close();
  });

  it('mọi route /dev/fakes/* và /dev/fake-oauth/* → 404', async () => {
    app = await startApi('production');
    for (const [method, path] of DEV_PATHS) {
      const agent = request(app.getHttpServer() as Server);
      const res = await agent[method](path).set('origin', TEST_ORIGIN).send({});
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});

describeDb('APP_ENV=test – route có, gắn tài khoản của phiên', () => {
  let t: TestApp;
  afterAll(async () => {
    await t.close();
  });

  it('chưa đăng nhập → 401; đã đăng nhập → 200; truyền accountId → 400 (không nhận mã tài khoản)', async () => {
    t = await createTestApp();
    const actors = await createActors(t);
    expect((await actors.anonymous.get('/api/v1/dev/fakes/scenarios')).status).toBe(401);
    expect((await actors.owner.get('/api/v1/dev/fakes/scenarios')).status).toBe(200);
    const bad = await actors.owner.put('/api/v1/dev/fakes/scenarios', {
      component: 'platform',
      target: '*',
      spec: { submit: 'published' },
      accountId: crypto.randomUUID(),
    });
    expect(bad.status).toBe(400);
    const ok = await actors.owner.put('/api/v1/dev/fakes/scenarios', {
      component: 'platform',
      target: '*',
      spec: { submit: 'published' },
    });
    expect(ok.status).toBe(200);
    // Cộng tác viên của tài khoản khác không thấy kịch bản này (gắn tài khoản trong phiên).
    const other = await createActors(t);
    expect((await other.owner.get('/api/v1/dev/fakes/scenarios')).body).toEqual([]);
    const fakePage = await actors.anonymous.get(
      '/api/v1/dev/fake-oauth/facebook_page/authorize?state=x&redirect_uri=http%3A%2F%2Fapp.test%2Fapi%2Fv1%2Fchannels%2Fcallback%2Ffacebook_page',
    );
    expect(fakePage.status).toBe(200);
    expect(fakePage.text).toContain('Đồng ý');
  });
});
