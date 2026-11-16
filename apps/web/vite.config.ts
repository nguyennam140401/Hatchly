import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { defineConfig } from 'vite';

// Web chạy dev qua proxy sang API nên không phụ thuộc CORS (contracts/http-api.md). API_PROXY_TARGET:
// đổi đích proxy (kiểm thử trình duyệt 006 chạy API ở cổng riêng).
// Danh mục thành phần chỉ mở khi `import.meta.env.DEV` hoặc VITE_ENABLE_CATALOG=1 (FR-012).
const api = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [tailwindcss(), react(), svgr({ include: '**/*.svg?react' })],
  server: {
    port: 5173,
    proxy: { '/api': api, '/healthz': api, '/readyz': api },
  },
  build: {
    // Sourcemap để tooling/check-web-bundle.mjs quét nguồn của gói (SC-008).
    sourcemap: true,
  },
});
