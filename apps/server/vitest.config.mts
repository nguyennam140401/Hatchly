import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// unplugin-swc: Vitest mặc định dùng esbuild, không sinh decorator metadata mà NestJS cần.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.spec.ts'],
    // Chạy riêng: CSDL + e2e xác thực + lệnh vận hành + test/context (006) bằng `pnpm test:db`, hàng chờ bằng `pnpm test:queue`.
    exclude: [
      'test/db/**',
      'test/queue/**',
      'test/auth/**/*.e2e.spec.ts',
      'test/ops/**',
      'test/context/**',
      '**/node_modules/**',
    ],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
