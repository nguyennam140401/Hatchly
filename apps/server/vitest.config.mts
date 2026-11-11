import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// unplugin-swc: Vitest mặc định dùng esbuild, không sinh decorator metadata mà NestJS cần.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    // 005 (T011): nhật ký thao tác cổng → test-logs/*.ndjson để quét bí mật (SC-009).
    setupFiles: ['./test/setup/log-capture.ts'],
    include: ['test/**/*.spec.ts'],
    // Chạy riêng: CSDL + e2e xác thực + lệnh vận hành bằng `pnpm test:db`, hàng chờ bằng `pnpm test:queue`.
    exclude: [
      'test/db/**',
      'test/queue/**',
      'test/auth/**/*.e2e.spec.ts',
      'test/ops/**',
      // 005: chế độ sandbox / bản thật / e2e cần CSDL hoặc dịch vụ cục bộ.
      'test/contracts/**/*.sandbox.contract.spec.ts',
      'test/contracts/**/*.infra.contract.spec.ts',
      'test/e2e/**',
      '**/node_modules/**',
    ],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
