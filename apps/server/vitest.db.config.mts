import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Kiểm thử tích hợp CSDL (002, research R16): PostgreSQL THẬT, CSDL tạm app_test_<ngẫu nhiên> do
// globalSetup tạo từ TEST_DATABASE_ADMIN_URL. Chạy tuần tự – các tệp dùng chung một CSDL.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    // 005 (T011): nhật ký thao tác cổng → test-logs/*.ndjson để quét bí mật (SC-009).
    setupFiles: ['./test/setup/log-capture.ts'],
    // 004: e2e xác thực (test/auth/**/*.e2e.spec.ts) và lệnh vận hành (test/ops) cần CSDL thật.
    include: [
      'test/db/**/*.db.spec.ts',
      'test/auth/**/*.e2e.spec.ts',
      'test/ops/**/*.spec.ts',
      // 005: hợp đồng chế độ `sandbox` + e2e chạy trên bản giả lập (cần phiên đăng nhập thật).
      'test/contracts/**/*.sandbox.contract.spec.ts',
      'test/e2e/**/*.e2e.spec.ts',
    ],
    globalSetup: ['./test/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // moduleSchema('sandbox') chỉ hợp lệ ở development/test.
    env: { APP_ENV: 'test' },
  },
});
