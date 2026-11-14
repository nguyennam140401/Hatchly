import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// test:compat (008, contracts/quality-gates.md mục 7) – HỢP ĐỒNG mọi phiên bản từ 008 trở đi phải giữ:
// chạy bản code NÀY trên CSDL ĐÃ migrate sẵn bằng migration của bản mới hơn. Không globalSetup (không tạo
// CSDL, không migrate) – CSDL và các URL vai trò do `db:compat` / Jenkins cấp qua COMPAT_DATABASE_*_URL.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/compat/**/*.compat.spec.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: { APP_ENV: 'test' },
  },
});
