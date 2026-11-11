import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Kiểm thử hợp đồng bản THẬT trên dịch vụ cục bộ (005, research R15): S3 → MinIO, SMTP → Mailpit.
// Cần `docker compose up -d minio minio-init mailpit`. Chạy tuần tự.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/contracts/**/*.infra.contract.spec.ts'],
    setupFiles: ['./test/setup/log-capture.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: { APP_ENV: 'test' },
  },
});
