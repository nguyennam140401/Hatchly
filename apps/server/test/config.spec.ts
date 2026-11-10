import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  assertWorkerDatabaseConfig,
  ConfigError,
  loadConfig,
  loadConfigFrom,
} from '../src/core/config/load-config';
import { resolveAuthConfig } from '../src/core/config/auth-config';
import { secret } from '../src/core/config/config.schema';
import { TEST_AUTH_ENV } from './helpers/auth-env';

const DB = { DATABASE_APP_URL: 'postgres://app:x@127.0.0.1:5432/app' };

describe('loadConfig', () => {
  it('thiếu APP_ENV → ConfigError liệt kê APP_ENV', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({});
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const e = err as ConfigError;
      expect(e.issues.map((i) => i.variable)).toContain('APP_ENV');
      expect(e.message).toContain('APP_ENV: bắt buộc');
    }
  });

  it('giá trị sai API_PORT=abc → nêu API_PORT', () => {
    expect(() => loadConfig({ ...DB, APP_ENV: 'development', API_PORT: 'abc' })).toThrow(
      /API_PORT/,
    );
  });

  it('cổng ngoài khoảng → lỗi', () => {
    expect(() => loadConfig({ ...DB, APP_ENV: 'test', WORKER_HEALTH_PORT: '70000' })).toThrow(
      /WORKER_HEALTH_PORT/,
    );
  });

  it('mặc định đúng bảng data-model.md mục 3', () => {
    const config = loadConfig({ ...DB, APP_ENV: 'development' });
    expect(config).toEqual({
      ...DB,
      DATABASE_POOL_MAX: 10,
      DATABASE_STATEMENT_TIMEOUT_MS: 15000,
      DATABASE_IDLE_IN_TX_TIMEOUT_MS: 30000,
      APP_ENV: 'development',
      APP_VERSION: '0.0.0-dev',
      API_PORT: 3000,
      WORKER_HEALTH_PORT: 3001,
      SHUTDOWN_TIMEOUT_MS: 30000,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: ['http://localhost:5173'],
      SESSION_IDLE_DAYS: 14,
      SESSION_ABSOLUTE_DAYS: 30,
      STAFF_SESSION_IDLE_MINUTES: 30,
      STAFF_SESSION_ABSOLUTE_HOURS: 12,
      STAFF_ALLOWED_CIDRS: [],
      LOGIN_MAX_FAILURES_PER_EMAIL: 5,
      LOGIN_MAX_FAILURES_PER_IP: 30,
      LOGIN_WINDOW_MINUTES: 15,
      LOGIN_BLOCK_MINUTES: 15,
      ARGON2_MEMORY_KIB: 19456,
      ARGON2_TIME_COST: 2,
      QUEUE_ENABLED: true,
      QUEUE_CONTROL_POOL_MAX: 6,
      QUEUE_API_POOL_MAX: 2,
      QUEUE_SETTINGS_REFRESH_MS: 60000,
      QUEUE_SCHEDULER_TICK_MS: 10000,
    });
  });

  it('biến hàng chờ (003): đọc giá trị, ngoài khoảng → nêu tên biến', () => {
    const config = loadConfig({
      ...DB,
      APP_ENV: 'test',
      QUEUE_ENABLED: 'false',
      QUEUE_CONTROL_POOL_MAX: '8',
      QUEUE_SETTINGS_REFRESH_MS: '10000',
    });
    expect(config.QUEUE_ENABLED).toBe(false);
    expect(config.QUEUE_CONTROL_POOL_MAX).toBe(8);
    expect(config.QUEUE_SETTINGS_REFRESH_MS).toBe(10000);
    expect(() => loadConfig({ ...DB, APP_ENV: 'test', QUEUE_CONTROL_POOL_MAX: '1' })).toThrow(
      /QUEUE_CONTROL_POOL_MAX/,
    );
    expect(() => loadConfig({ ...DB, APP_ENV: 'test', QUEUE_API_POOL_MAX: '6' })).toThrow(
      /QUEUE_API_POOL_MAX/,
    );
    expect(() =>
      loadConfig({ ...DB, APP_ENV: 'test', QUEUE_SETTINGS_REFRESH_MS: '400000' }),
    ).toThrow(/QUEUE_SETTINGS_REFRESH_MS/);
    expect(() => loadConfig({ ...DB, APP_ENV: 'test', QUEUE_SCHEDULER_TICK_MS: '500' })).toThrow(
      /QUEUE_SCHEDULER_TICK_MS/,
    );
    expect(() => loadConfig({ ...DB, APP_ENV: 'test', QUEUE_ENABLED: 'yes' })).toThrow(
      /QUEUE_ENABLED/,
    );
  });

  it('CORS_ORIGINS tách theo dấu phẩy', () => {
    const config = loadConfig({
      ...DB,
      APP_ENV: 'staging',
      CORS_ORIGINS: 'https://a.example.vn, https://b.example.vn',
    });
    expect(config.CORS_ORIGINS).toEqual(['https://a.example.vn', 'https://b.example.vn']);
  });

  it('biến bí mật không bao giờ xuất hiện giá trị trong thông điệp lỗi', () => {
    const schema = z.object({
      DB_PASSWORD: secret(z.string().min(32)),
      PLAIN: z.string().min(10),
    });
    const value = 'mat-khau-ngan-123';
    try {
      loadConfigFrom(schema, { DB_PASSWORD: value, PLAIN: 'ngan' });
      expect.unreachable();
    } catch (err) {
      const e = err as ConfigError;
      expect(e.message).toContain('DB_PASSWORD');
      expect(e.message).not.toContain(value);
      expect(e.message).not.toContain('ngan');
      expect(JSON.stringify(e.issues)).not.toContain(value);
    }
  });
});

describe('cấu hình CSDL (002)', () => {
  it('thiếu DATABASE_APP_URL → ConfigError nêu tên biến', () => {
    try {
      loadConfig({ APP_ENV: 'test' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).message).toContain('DATABASE_APP_URL: bắt buộc');
    }
  });

  it('URL sai định dạng → "giá trị chưa hợp lệ", không lộ giá trị/mật khẩu', () => {
    const bad = 'mysql://app:S3cr3t_marker@db/app';
    try {
      loadConfig({
        APP_ENV: 'test',
        DATABASE_APP_URL: bad,
        DATABASE_SUPPORT_URL: 'khong-phai-url',
      });
      expect.unreachable();
    } catch (err) {
      const e = err as ConfigError;
      expect(e.message).toContain('DATABASE_APP_URL: giá trị chưa hợp lệ');
      expect(e.message).toContain('DATABASE_SUPPORT_URL: giá trị chưa hợp lệ');
      expect(e.message).not.toContain('S3cr3t_marker');
      expect(e.message).not.toContain('khong-phai-url');
    }
  });

  it('nhận cả postgres:// và postgresql://', () => {
    const c = loadConfig({
      APP_ENV: 'test',
      DATABASE_APP_URL: 'postgresql://app:x@db:5432/app',
      DATABASE_SYSTEM_URL: 'postgres://system:x@db/app',
    });
    expect(c.DATABASE_SYSTEM_URL).toBe('postgres://system:x@db/app');
  });

  it('Worker thiếu DATABASE_SYSTEM_URL → lỗi nêu tên biến', () => {
    const config = loadConfig({ ...DB, APP_ENV: 'test' });
    expect(() => {
      assertWorkerDatabaseConfig(config);
    }).toThrow(/DATABASE_SYSTEM_URL: bắt buộc/);
    expect(() => {
      assertWorkerDatabaseConfig({ ...config, DATABASE_SYSTEM_URL: 'postgres://s:x@h/app' });
    }).not.toThrow();
  });

  it('giới hạn bể và thời gian chờ (002)', () => {
    expect(() => loadConfig({ ...DB, APP_ENV: 'test', DATABASE_POOL_MAX: '0' })).toThrow(
      /DATABASE_POOL_MAX/,
    );
    expect(() =>
      loadConfig({ ...DB, APP_ENV: 'test', DATABASE_STATEMENT_TIMEOUT_MS: '10' }),
    ).toThrow(/DATABASE_STATEMENT_TIMEOUT_MS/);
  });
});

describe('cấu hình xác thực của API (004)', () => {
  const base = { ...DB, APP_ENV: 'test' };

  it('thiếu biến bắt buộc → ConfigError nêu đủ tên biến', () => {
    try {
      resolveAuthConfig(loadConfig(base));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const names = (err as ConfigError).issues.map((i) => i.variable);
      expect(names).toEqual(
        expect.arrayContaining([
          'WEB_BASE_URL',
          'AUTH_THROTTLE_SECRET',
          'TERMS_VERSION',
          'MAIL_TRANSPORT',
        ]),
      );
    }
  });

  it('đủ biến → mặc định WEB_ORIGINS = gốc WEB_BASE_URL, TRUST_PROXY_HOPS theo APP_ENV', () => {
    const auth = resolveAuthConfig(
      loadConfig({ ...base, ...TEST_AUTH_ENV, WEB_ORIGINS: '', WEB_BASE_URL: 'https://a.vn/app/' }),
    );
    expect(auth.webOrigins).toEqual(['https://a.vn']);
    expect(auth.webBaseUrl).toBe('https://a.vn/app');
    expect(auth.trustProxyHops).toBe(0);
    expect(auth.mail).toEqual({ transport: 'memory' });
    const staging = resolveAuthConfig(
      loadConfig({
        ...base,
        ...TEST_AUTH_ENV,
        APP_ENV: 'staging',
        MAIL_TRANSPORT: 'smtp',
        SMTP_URL: 'smtp://mail:1025',
        MAIL_FROM: 'no-reply@a.vn',
      }),
    );
    expect(staging.trustProxyHops).toBe(1);
  });

  it('MAIL_TRANSPORT=memory ở production → bị từ chối', () => {
    expect(() =>
      resolveAuthConfig(loadConfig({ ...base, ...TEST_AUTH_ENV, APP_ENV: 'production' })),
    ).toThrow(/MAIL_TRANSPORT/);
  });

  it('MAIL_TRANSPORT=smtp thiếu SMTP_URL, MAIL_FROM → nêu tên biến', () => {
    expect(() =>
      resolveAuthConfig(loadConfig({ ...base, ...TEST_AUTH_ENV, MAIL_TRANSPORT: 'smtp' })),
    ).toThrow(/SMTP_URL: bắt buộc[\s\S]*MAIL_FROM: bắt buộc/);
  });

  it('CIDR sai → nêu STAFF_ALLOWED_CIDRS; CIDR IPv4/IPv6 đúng được nhận', () => {
    expect(() => loadConfig({ ...base, STAFF_ALLOWED_CIDRS: '10.0.0.0/33' })).toThrow(
      /STAFF_ALLOWED_CIDRS/,
    );
    expect(() => loadConfig({ ...base, STAFF_ALLOWED_CIDRS: 'abc' })).toThrow(
      /STAFF_ALLOWED_CIDRS/,
    );
    const c = loadConfig({ ...base, STAFF_ALLOWED_CIDRS: '10.0.0.0/8, 2001:db8::/32' });
    expect(c.STAFF_ALLOWED_CIDRS).toEqual(['10.0.0.0/8', '2001:db8::/32']);
  });

  it('AUTH_THROTTLE_SECRET ngắn, SMTP_URL sai → lỗi, không lộ giá trị bí mật', () => {
    try {
      loadConfig({ ...base, AUTH_THROTTLE_SECRET: 'ngan_qua_marker', SMTP_URL: 'http://x_marker' });
      expect.unreachable();
    } catch (err) {
      const e = err as ConfigError;
      expect(e.message).toContain('AUTH_THROTTLE_SECRET: giá trị chưa hợp lệ');
      expect(e.message).toContain('SMTP_URL: giá trị chưa hợp lệ');
      expect(e.message).not.toContain('marker');
    }
  });
});
