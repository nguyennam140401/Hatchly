// pnpm check:web-bundle – build apps/web rồi khẳng định gói web không chứa mã có nguồn từ apps/server (SC-008).
// Quét trường `sources` của mọi sourcemap trong apps/web/dist.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = join('apps', 'web', 'dist');

const build = spawnSync('pnpm --filter @app/web build', { shell: true, stdio: 'inherit' });
if (build.status !== 0) {
  console.error('✗ Build apps/web thất bại.');
  process.exit(1);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const maps = [...walk(DIST)].filter((f) => f.endsWith('.map'));
if (maps.length === 0) {
  console.error(
    '✗ Không có sourcemap trong apps/web/dist – kiểm tra build.sourcemap trong vite.config.ts.',
  );
  process.exit(1);
}

const offenders = [];
let sourceCount = 0;
for (const file of maps) {
  const { sources = [] } = JSON.parse(readFileSync(file, 'utf8'));
  sourceCount += sources.length;
  for (const source of sources) {
    if (source.replace(/\\/g, '/').includes('apps/server')) {
      offenders.push(`${relative('.', file)} ← ${source}`);
    }
  }
}

if (offenders.length > 0) {
  console.error('✗ Gói web chứa mã từ apps/server (web chỉ được dùng @app/shared):');
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log(
  `✓ Gói web sạch: ${maps.length} sourcemap, ${sourceCount} nguồn, không có apps/server.`,
);
