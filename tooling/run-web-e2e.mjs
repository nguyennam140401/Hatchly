// pnpm test:web-e2e – kiểm thử trình duyệt của giao diện (011): danh mục thành phần ở 360/768/1280 px, khung theo vai trò,
// hết phiên giữa chừng, hai tab. Không cần CSDL (API được chặn bằng page.route).
// Thiếu Chromium của Playwright → in `SKIPPED:` (máy cá nhân bỏ qua, `pnpm verify --ci` tính là KHÔNG ĐẠT – FR-008 của 008).
import { spawnSync } from 'node:child_process';

const result = spawnSync('pnpm', ['--filter', '@app/web', 'test:e2e'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
process.stdout.write(output);

if (result.status !== 0 && /Executable doesn't exist|playwright install/i.test(output)) {
  console.log(
    'SKIPPED: chưa cài Chromium cho Playwright (chạy: pnpm --filter @app/web exec playwright install chromium --only-shell)',
  );
  process.exit(0);
}
process.exit(result.status ?? 1);
