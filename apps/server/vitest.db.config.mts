import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Kiểm thử tích hợp CSDL (002, research R16): PostgreSQL THẬT, CSDL tạm app_test_<ngẫu nhiên> do
// globalSetup tạo từ TEST_DATABASE_ADMIN_URL. Chạy tuần tự – các tệp dùng chung một CSDL.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/db/**/*.db.spec.ts'],
    globalSetup: ['./test/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // moduleSchema('sandbox') chỉ hợp lệ ở development/test.
    env: { APP_ENV: 'test' },
  },
});
