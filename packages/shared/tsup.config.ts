import { defineConfig } from 'tsup';

// Build gói dùng chung ra ESM (web) + CJS (máy chủ NestJS) + .d.ts (R9).
// Mỗi module một lối vào riêng để thêm module không phải sửa `exports` (FR-015).
export default defineConfig({
  entry: ['src/index.ts', 'src/core/index.ts', 'src/auth/index.ts', 'src/modules/*/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2023',
  outDir: 'dist',
});
