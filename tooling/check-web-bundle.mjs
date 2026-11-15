// pnpm check:web-bundle – build apps/web rồi kiểm gói web:
//   1. không chứa mã có nguồn từ apps/server (SC-008, quét `sources` của sourcemap);
//   2. gói KHỞI ĐẦU (script/modulepreload trong index.html) không chứa danh mục `/catalog/` hay khu vực `/internal/` (011 FR-012, SC-006);
//   3. gói khởi đầu không vượt BUNDLE_BUDGET_KB (gzip) trong tooling/check-web-bundle.budget.json
//      (null = chưa đặt: chỉ in kích thước; đặt sau bản dựng đầu ở T081).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join('apps', 'web', 'dist');
const BUDGET_FILE = join(here, 'check-web-bundle.budget.json');

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Các tệp JS gói khởi đầu: `<script src>` và `<link rel="modulepreload">` trong index.html. */
export function initialChunks(dist) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const refs = new Set();
  for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*\shref="([^"]+)"/g)) refs.add(m[1]);
  return [...refs].map((r) => join(dist, r.replace(/^\//, '')));
}

/** Phân tích gói khởi đầu: kích thước gzip và các nguồn không được phép có mặt. */
export function analyzeInitialBundle(dist) {
  const chunks = initialChunks(dist).filter((f) => f.endsWith('.js') && existsSync(f));
  let gzipBytes = 0;
  const forbidden = [];
  for (const file of chunks) {
    gzipBytes += gzipSync(readFileSync(file)).length;
    const mapPath = `${file}.map`;
    if (!existsSync(mapPath)) continue;
    const { sources = [] } = JSON.parse(readFileSync(mapPath, 'utf8'));
    for (const source of sources) {
      const s = source.replace(/\\/g, '/');
      if (/\/src\/catalog\//.test(s) || /\/src\/internal\//.test(s) || /\/_catalog\b/.test(s)) {
        forbidden.push(`${relative('.', file)} ← ${s}`);
      }
    }
  }
  return { chunks: chunks.length, gzipKb: gzipBytes / 1024, forbidden };
}

export function readBudgetKb() {
  if (!existsSync(BUDGET_FILE)) return null;
  const value = JSON.parse(readFileSync(BUDGET_FILE, 'utf8')).BUNDLE_BUDGET_KB;
  return typeof value === 'number' ? value : null;
}

function main() {
  const build = spawnSync('pnpm --filter @app/web build', {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, VITE_ENABLE_CATALOG: '' },
  });
  if (build.status !== 0) {
    console.error('✗ Build apps/web thất bại.');
    process.exit(1);
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

  const initial = analyzeInitialBundle(DIST);
  if (initial.forbidden.length > 0) {
    console.error('✗ Gói khởi đầu chứa danh mục hoặc khu vực nội bộ (phải tải lười, FR-012):');
    for (const o of initial.forbidden) console.error(`  ${o}`);
    process.exit(1);
  }
  const budget = readBudgetKb();
  const size = `${initial.gzipKb.toFixed(1)} KB gzip (${String(initial.chunks)} tệp)`;
  if (budget !== null && initial.gzipKb > budget) {
    console.error(`✗ Gói khởi đầu ${size} vượt ngân sách ${String(budget)} KB.`);
    process.exit(1);
  }
  console.log(
    `✓ Gói khởi đầu ${size}, không chứa catalog/internal${budget === null ? ' (chưa đặt ngân sách)' : ` (≤ ${String(budget)} KB)`}.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
