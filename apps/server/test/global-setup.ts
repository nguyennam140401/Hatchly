import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Build trước khi kiểm thử: shutdown.spec.ts và multi-worker.spec.ts chạy tiến trình con thật từ dist.
// Không build lại @app/shared nếu đã có dist – tránh xóa dist khi gói khác đang kiểm thử song song.
export default function setup(): void {
  const sharedDist = resolve(
    process.cwd(),
    '..',
    '..',
    'packages',
    'shared',
    'dist',
    'core',
    'index.cjs',
  );
  if (!existsSync(sharedDist)) {
    execSync('pnpm --filter @app/shared build', { stdio: 'inherit' });
  }
  execSync('pnpm run build', { stdio: 'inherit' });
}
