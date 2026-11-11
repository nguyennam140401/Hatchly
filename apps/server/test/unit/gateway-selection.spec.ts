import { describe, expect, it } from 'vitest';
import { assertNoFakesInProduction } from '../../src/core/config/assert-no-fakes';
import { AppConfigSchema } from '../../src/core/config/config.schema';
import { ConfigError, loadConfig, loadConfigFrom } from '../../src/core/config/load-config';
import { readGatewaySelection } from '../../src/core/gateways/selection';

// T010 (005, SC-006, US6-AS1/AS2): staging/production từ chối MỌI tổ hợp có thành phần giả, nêu đúng tên
// biến; dev/test cho qua; API và Worker đọc cùng biến → cùng lựa chọn.

const DB = { DATABASE_APP_URL: 'postgres://app:x@127.0.0.1:1/app' };
const S3 = {
  S3_ENDPOINT: 'http://s3.example.vn',
  S3_REGION: 'hn-1',
  S3_BUCKET: 'app-prod',
  S3_ACCESS_KEY_ID: 'AK_TEST_ONLY',
  S3_SECRET_ACCESS_KEY: 'SK_TEST_ONLY',
};

/** Các biến có thể chọn bản giả lập, kèm giá trị "giả" của từng biến. */
const FAKE_VARS: [string, string][] = [
  ['PLATFORM_GATEWAY_DRIVER', 'fake'],
  ['AI_GATEWAY_DRIVER', 'fake'],
  ['NOTIFICATIONS_DRIVER', 'fake'],
  ['STORAGE_DRIVER', 'memory'],
  ['MAIL_TRANSPORT', 'memory'],
  ['FAKE_STATE_STORE', 'sandbox'],
];

/** Mọi tập con khác rỗng của FAKE_VARS. */
function subsets<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << items.length; mask++) {
    out.push(items.filter((_, i) => (mask & (1 << i)) !== 0));
  }
  return out;
}

function parseRaw(env: Record<string, string>) {
  return loadConfigFrom(AppConfigSchema, env);
}

describe('assertNoFakesInProduction (SC-006)', () => {
  for (const appEnv of ['production', 'staging'] as const) {
    it(`${appEnv}: mọi tổ hợp có ≥ 1 thành phần giả → ConfigError nêu đủ tên biến`, () => {
      for (const combo of subsets(FAKE_VARS)) {
        const env: Record<string, string> = {
          ...DB,
          ...S3,
          APP_ENV: appEnv,
          STORAGE_DRIVER: 's3',
          MAIL_TRANSPORT: 'smtp',
          SMTP_URL: 'smtp://mail:25',
          MAIL_FROM: 'no-reply@a.vn',
          ...Object.fromEntries(combo),
        };
        const config = parseRaw(env);
        let error: unknown;
        try {
          assertNoFakesInProduction(config);
        } catch (err) {
          error = err;
        }
        expect(error, combo.map(([k]) => k).join(',')).toBeInstanceOf(ConfigError);
        const e = error as ConfigError;
        expect(e.message).toContain(`Môi trường ${appEnv} không được dùng bản giả lập:`);
        expect(e.issues.map((i) => i.variable).sort()).toEqual(combo.map(([k]) => k).sort());
        for (const [k, v] of combo) expect(e.message).toContain(`${k}=${v}`);
        // Không lộ bí mật.
        expect(e.message).not.toContain('SK_TEST_ONLY');
      }
    });
  }

  it('production qua loadConfig: thông điệp ví dụ của hợp đồng', () => {
    expect(() =>
      loadConfig({
        ...DB,
        ...S3,
        APP_ENV: 'production',
        PLATFORM_GATEWAY_DRIVER: 'fake',
        AI_GATEWAY_DRIVER: 'fake',
        NOTIFICATIONS_DRIVER: 'fake',
        STORAGE_DRIVER: 's3',
      }),
    ).toThrow(
      'Môi trường production không được dùng bản giả lập: PLATFORM_GATEWAY_DRIVER=fake, AI_GATEWAY_DRIVER=fake, NOTIFICATIONS_DRIVER=fake',
    );
  });

  it('production thiếu biến chọn bản cài đặt → bắt buộc', () => {
    try {
      loadConfig({ ...DB, APP_ENV: 'production' });
      expect.unreachable();
    } catch (err) {
      expect((err as ConfigError).issues.map((i) => i.variable)).toEqual([
        'PLATFORM_GATEWAY_DRIVER',
        'AI_GATEWAY_DRIVER',
        'NOTIFICATIONS_DRIVER',
        'STORAGE_DRIVER',
      ]);
    }
  });

  it('STORAGE_DRIVER=s3 thiếu S3_* → nêu tên biến, không giá trị', () => {
    expect(() => loadConfig({ ...DB, APP_ENV: 'test', STORAGE_DRIVER: 's3' })).toThrow(
      /S3_ENDPOINT: bắt buộc[\s\S]*S3_SECRET_ACCESS_KEY: bắt buộc/,
    );
  });

  it('development/test: cho qua, mặc định bản giả lập + kho bộ nhớ', () => {
    for (const appEnv of ['development', 'test']) {
      const config = loadConfig({ ...DB, APP_ENV: appEnv });
      expect(readGatewaySelection(config)).toEqual({
        platform: 'fake',
        ai: 'fake',
        notifications: 'fake',
        storage: 'memory',
        mail: 'memory',
        fakeState: 'memory',
      });
      const full = loadConfig({
        ...DB,
        ...S3,
        APP_ENV: appEnv,
        STORAGE_DRIVER: 's3',
        FAKE_STATE_STORE: 'sandbox',
        MAIL_TRANSPORT: 'smtp',
        SMTP_URL: 'smtp://mailpit:1025',
        MAIL_FROM: 'a@b.test',
      });
      expect(readGatewaySelection(full)).toMatchObject({
        storage: 's3',
        mail: 'smtp',
        fakeState: 'sandbox',
      });
    }
  });

  it('API và Worker đọc cùng biến → cùng lựa chọn', () => {
    const env = {
      ...DB,
      ...S3,
      APP_ENV: 'development',
      DATABASE_SYSTEM_URL: 'postgres://system:x@127.0.0.1:1/app',
      STORAGE_DRIVER: 's3',
      FAKE_STATE_STORE: 'sandbox',
      MAIL_TRANSPORT: 'smtp',
      SMTP_URL: 'smtp://mailpit:1025',
      MAIL_FROM: 'a@b.test',
    };
    // Hai lần đọc độc lập (hai tiến trình) cho cùng kết quả.
    expect(readGatewaySelection(loadConfig({ ...env }))).toEqual(
      readGatewaySelection(loadConfig({ ...env })),
    );
  });
});
