import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// unplugin-swc: Vitest mặc định dùng esbuild, không sinh decorator metadata mà NestJS cần.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.spec.ts'],
    // Kiểm thử CSDL / hàng chờ chạy riêng bằng `pnpm test:db` / `pnpm test:queue`.
    exclude: ['test/db/**', 'test/queue/**', '**/node_modules/**'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
