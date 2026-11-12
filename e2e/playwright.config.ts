import { defineConfig, devices } from '@playwright/test';
import { STATE_FILE } from './state';

// Kiểm thử đầu-cuối qua trình duyệt (006 R12, nhóm g) – chỉ Chromium.
// webServer 1: apps/server/src/ops/e2e-env.ts tạo CSDL tạm từ TEST_DATABASE_ADMIN_URL, chạy API ở cổng
// 3100 và mồi chủ + cộng tác viên (trạng thái ghi ra STATE_FILE). webServer 2: Vite ở cổng 5180, proxy
// /api sang 3100. Không chạm cổng dev 3000/5173. Thiếu TEST_DATABASE_ADMIN_URL → bỏ qua có thông báo.

const API_PORT = 3100;
const WEB_PORT = 5180;
const hasDb = (process.env.TEST_DATABASE_ADMIN_URL ?? '') !== '';

if (!hasDb) console.log('Bỏ qua kiểm thử trình duyệt: chưa đặt TEST_DATABASE_ADMIN_URL');

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(hasDb
    ? {
        webServer: [
          {
            command: `pnpm --filter @app/server exec tsx src/ops/e2e-env.ts "${STATE_FILE}"`,
            url: `http://localhost:${API_PORT}/healthz`,
            env: {
              E2E_API_PORT: String(API_PORT),
              E2E_WEB_BASE_URL: `http://localhost:${WEB_PORT}`,
            },
            timeout: 120_000,
            reuseExistingServer: false,
            stdout: 'pipe',
          },
          {
            command: `pnpm --filter @app/web exec vite --port ${WEB_PORT} --strictPort`,
            url: `http://localhost:${WEB_PORT}`,
            env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
            timeout: 120_000,
            reuseExistingServer: false,
          },
        ],
      }
    : {}),
});
