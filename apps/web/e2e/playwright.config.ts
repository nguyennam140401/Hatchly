import { defineConfig } from '@playwright/test';

// E2E trình duyệt cho giao diện (011): danh mục thành phần + khung + phiên. 3 khung nhìn theo FR-007/SC-003:
// 360 (điện thoại nhỏ nhất được hỗ trợ), 768 (máy tính bảng), 1280 (máy tính).
// Không phụ thuộc API thật: các kịch bản chặn mạng bằng `page.route`.
const PORT = 5174;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone-360', use: { viewport: { width: 360, height: 740 } } },
    { name: 'tablet-768', use: { viewport: { width: 768, height: 1024 } } },
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `pnpm exec vite --port ${String(PORT)} --strictPort`,
    cwd: '..',
    port: PORT,
    reuseExistingServer: !process.env.CI,
    env: { VITE_ENABLE_CATALOG: '1' },
    timeout: 60_000,
  },
});
