import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  assertWorkerDatabaseConfig,
  ConfigError,
  loadConfig,
  loadConfigFrom,
} from '../src/core/config/load-config';
import { secret } from '../src/core/config/config.schema';

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
    });
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

  it('giới hạn bể và thời gian chờ', () => {
    expect(() => loadConfig({ ...DB, APP_ENV: 'test', DATABASE_POOL_MAX: '0' })).toThrow(
      /DATABASE_POOL_MAX/,
    );
    expect(() =>
      loadConfig({ ...DB, APP_ENV: 'test', DATABASE_STATEMENT_TIMEOUT_MS: '10' }),
    ).toThrow(/DATABASE_STATEMENT_TIMEOUT_MS/);
  });
});
