import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigError, loadConfig, loadConfigFrom } from '../src/core/config/load-config';
import { secret } from '../src/core/config/config.schema';

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
    expect(() => loadConfig({ APP_ENV: 'development', API_PORT: 'abc' })).toThrow(/API_PORT/);
  });

  it('cổng ngoài khoảng → lỗi', () => {
    expect(() => loadConfig({ APP_ENV: 'test', WORKER_HEALTH_PORT: '70000' })).toThrow(
      /WORKER_HEALTH_PORT/,
    );
  });

  it('mặc định đúng bảng data-model.md mục 3', () => {
    const config = loadConfig({ APP_ENV: 'development' });
    expect(config).toEqual({
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
