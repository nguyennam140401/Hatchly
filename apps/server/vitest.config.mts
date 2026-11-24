import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// unplugin-swc: Vitest mặc định dùng esbuild, không sinh decorator metadata mà NestJS cần.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    // 005 (T011): nhật ký thao tác cổng → test-logs/*.ndjson để quét bí mật (SC-009).
    setupFiles: ['./test/setup/log-capture.ts'],
    include: ['test/**/*.spec.ts'],
    // Chạy riêng: CSDL + e2e xác thực + lệnh vận hành + test/context (006) bằng `pnpm test:db`, hàng chờ bằng `pnpm test:queue`.
    exclude: [
      'test/db/**',
      'test/queue/**',
      'test/auth/**/*.e2e.spec.ts',
      'test/ops/**',
      // 005: chế độ sandbox / bản thật / e2e cần CSDL hoặc dịch vụ cục bộ.
      'test/contracts/**/*.sandbox.contract.spec.ts',
      'test/contracts/**/*.infra.contract.spec.ts',
      'test/e2e/**',
      'test/context/**',
      'test/media/**',
      'test/compat/**',
      // 015: spec Cổng AI cần CSDL chạy ở `pnpm test:db`; spec thuần (token-estimate) vẫn chạy ở chế độ bộ nhớ.
      'test/ai_gateway/**/*.db.spec.ts',
      'test/ai_gateway/ledger-partitions.spec.ts',
      'test/ai_gateway/price-effective.spec.ts',
      'test/ai_gateway/ledger-reconcile.spec.ts',
      'test/contracts/ai/**/*.db.contract.spec.ts',
      '**/node_modules/**',
    ],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
