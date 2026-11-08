// Chạy kiểm thử máy chủ trong container Linux `node:24-bookworm-slim` (cho máy Windows).
// Lý do: trên Windows `child.kill('SIGTERM')` giết tiến trình ngay nên kiểm thử tắt có kiểm soát
// (SC-004) bị bỏ qua (R5). Kho được gắn chỉ đọc rồi chép sang thư mục riêng trong container để
// `pnpm install` không ghi đè node_modules của máy Windows.
//
// Dùng: pnpm --filter @app/server test:linux [tên tệp kiểm thử…]   (mặc định: shutdown multi-worker)
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const filters = process.argv.slice(2);
const testArgs = (filters.length > 0 ? filters : ['shutdown', 'multi-worker']).join(' ');

const script = [
  'set -e',
  'mkdir -p /work',
  'cd /src',
  "tar --exclude='./node_modules' --exclude='*/node_modules' --exclude='*/dist' --exclude='./.git' -cf - . | tar -xf - -C /work",
  'cd /work',
  'corepack enable',
  'pnpm config set store-dir /pnpm-store',
  'pnpm install --frozen-lockfile --filter @app/server... --filter @app/shared',
  'pnpm --filter @app/shared build',
  `pnpm --filter @app/server exec vitest run ${testArgs}`,
].join(' && ');

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-v',
    `${repoRoot}:/src:ro`,
    '-v',
    'app-pnpm-store:/pnpm-store',
    'node:24-bookworm-slim',
    'sh',
    '-c',
    script,
  ],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
