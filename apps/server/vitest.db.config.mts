import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Kiểm thử tích hợp CSDL (002, research R16): PostgreSQL THẬT, CSDL tạm app_test_<ngẫu nhiên> do
// globalSetup tạo từ TEST_DATABASE_ADMIN_URL. Chạy tuần tự – các tệp dùng chung một CSDL.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    // 004: e2e xác thực (test/auth/**/*.e2e.spec.ts) và lệnh vận hành (test/ops) cần CSDL thật.
    // 006: kiểm thử của module nghiệp vụ cần CSDL (test/context/**: e2e API, hợp đồng công khai).
    include: [
      'test/db/**/*.db.spec.ts',
      'test/auth/**/*.e2e.spec.ts',
      'test/ops/**/*.spec.ts',
      'test/context/**/*.spec.ts',
    ],
    globalSetup: ['./test/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // moduleSchema('sandbox') chỉ hợp lệ ở development/test.
    env: { APP_ENV: 'test' },
  },
});
