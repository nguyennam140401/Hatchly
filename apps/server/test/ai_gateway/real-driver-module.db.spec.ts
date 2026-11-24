import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { APP_CONFIG, type AppConfig } from '../../src/core';
import { loadConfig } from '../../src/core/config/load-config';
import {
  AI_REAL_PARTS,
  AiGatewayModule,
  type RealAiParts,
} from '../../src/modules/ai_gateway/ai_gateway.module';
import { AI_GATEWAY, type AiGatewayPublicApi } from '../../src/modules/ai_gateway';
import { ACCOUNT_PUBLIC_API } from '../../src/modules/account';
import { NOTIFICATIONS } from '../../src/modules/notifications';
import { listSchedules } from '../../src/modules/queue/schedules';
import { TEST_AUTH_ENV } from '../helpers/auth-env';
import { dbUrls, describeDb, makeDatabase, type TestDatabase } from '../db/helpers/db';

// 015 T049 / T049c: dựng module Cổng AI ở `AI_GATEWAY_DRIVER=real` (module dựng nhẹ, CSDL thật cho `model_routes`).
// Seed của migration 0030 bật cả `anthropic` lẫn `openai` → driver `real` cần CẢ HAI khóa. Thiếu khóa cho tuyến đã bật →
// lỗi khởi động nêu TÊN biến, không in khóa nào. Worker đăng ký lịch dọn giữ chỗ hệ thống (`defineStaleSystemSchedule`); API không.
// Chạy `pnpm test:db`.

const ANT = 'sk-ant-KEYCANARY-aaaaaaaaaaaaaaaa';
const OAI = 'sk-oai-KEYCANARY-bbbbbbbbbbbbbbbb';
const SCHEDULE = 'ai_gateway.release_stale_system';

function configWith(extra: Record<string, string>): AppConfig {
  return loadConfig({
    APP_ENV: 'test',
    LOG_LEVEL: 'error',
    ...TEST_AUTH_ENV,
    DATABASE_APP_URL: dbUrls.app,
    DATABASE_SUPPORT_URL: dbUrls.support,
    DATABASE_SYSTEM_URL: dbUrls.system,
    AI_GATEWAY_DRIVER: 'real',
    ...extra,
  });
}

/** Module toàn cục cấp các cổng mà AiGatewayModule cần (cấu hình, thông báo, mốc chu kỳ tài khoản). */
function stubsFor(config: AppConfig) {
  @Global()
  @Module({
    providers: [
      { provide: APP_CONFIG, useValue: config },
      { provide: NOTIFICATIONS, useValue: { emit: () => Promise.resolve() } },
      { provide: ACCOUNT_PUBLIC_API, useValue: {} },
    ],
    exports: [APP_CONFIG, NOTIFICATIONS, ACCOUNT_PUBLIC_API],
  })
  class StubModule {}
  return StubModule;
}

async function build(unit: 'api' | 'worker', extra: Record<string, string>) {
  const config = configWith(extra);
  return Test.createTestingModule({
    imports: [stubsFor(config), AiGatewayModule.forUnit(unit)],
  }).compile();
}

const scheduleCount = () => listSchedules().filter((s) => s.name === SCHEDULE).length;

describeDb('Cổng AI – dựng module ở driver real (T049)', () => {
  let database: TestDatabase;
  beforeAll(() => {
    database = makeDatabase({ unit: 'worker', poolMax: 3 });
  });
  afterAll(async () => {
    await database.close();
  });

  it('seed bật cả anthropic và openai (tiền đề của các ca bên dưới)', async () => {
    const ref = await build('worker', { ANTHROPIC_API_KEY: ANT, OPENAI_API_KEY: OAI });
    try {
      const parts = ref.get<RealAiParts | null>(AI_REAL_PARTS);
      const providers = await parts!.routes.enabledProviders();
      expect(providers).toEqual(expect.arrayContaining(['anthropic', 'openai']));
    } finally {
      await ref.close();
    }
  });

  it('đủ hai khóa → dựng được cổng thật; Worker đăng ký lịch dọn giữ chỗ hệ thống', async () => {
    const ref = await build('worker', { ANTHROPIC_API_KEY: ANT, OPENAI_API_KEY: OAI });
    try {
      const gw = ref.get<AiGatewayPublicApi>(AI_GATEWAY);
      expect(typeof gw.generate).toBe('function');
      expect(scheduleCount()).toBe(1);
    } finally {
      await ref.close();
    }
  });

  it('API không đăng ký lịch dọn (chỉ Worker chạy việc nền)', async () => {
    const before = scheduleCount();
    const ref = await build('api', { ANTHROPIC_API_KEY: ANT, OPENAI_API_KEY: OAI });
    try {
      expect(scheduleCount()).toBe(before);
    } finally {
      await ref.close();
    }
  });

  it.each([
    ['thiếu ANTHROPIC_API_KEY', { OPENAI_API_KEY: OAI }, 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
    ['thiếu OPENAI_API_KEY', { ANTHROPIC_API_KEY: ANT }, 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
  ])(
    '%s → lỗi khởi động nêu tên biến thiếu, không nêu biến đủ, không in khóa',
    async (_n, keys, missing, present) => {
      const err = await build('worker', keys).then(
        async (ref) => {
          await ref.close();
          return undefined;
        },
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      const text = `${(err as Error).message}\n${(err as Error).stack ?? ''}`;
      expect(text).toContain(missing);
      expect(text).not.toContain(present);
      expect(text).not.toContain('KEYCANARY');
    },
  );

  it('thiếu cả hai khóa → lỗi nêu cả hai tên biến, không lặng lẽ rơi về bản giả lập', async () => {
    const err = await build('worker', {}).then(
      async (ref) => {
        await ref.close();
        return undefined;
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/ANTHROPIC_API_KEY/);
    expect((err as Error).message).toMatch(/OPENAI_API_KEY/);
  });
});
