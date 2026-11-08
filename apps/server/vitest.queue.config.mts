import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Kiểm thử tích hợp hàng chờ (003, research R17): PostgreSQL THẬT, dùng chung globalSetup của 002 (CSDL
// tạm app_test_<ngẫu nhiên>). Chạy tuần tự. Bộ chịu tải `test/queue/soak/**` chỉ chạy khi truyền
// `--dir test/queue/soak` (pnpm test:queue-soak).
const soak = process.argv.some((arg) => arg.includes('soak'));

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/queue/**/*.queue.spec.ts'],
    exclude: soak ? ['**/node_modules/**'] : ['test/queue/soak/**', '**/node_modules/**'],
    globalSetup: ['./test/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: soak ? 900_000 : 120_000,
    hookTimeout: 120_000,
    env: { APP_ENV: 'test' },
  },
});
