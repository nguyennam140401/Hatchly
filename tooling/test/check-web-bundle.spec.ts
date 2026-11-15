import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeInitialBundle } from '../check-web-bundle.mjs';

// FR-012/SC-006: gói khởi đầu không chứa danh mục hay khu vực nội bộ; chỉ tính chunk được index.html tham chiếu.
type Result = { chunks: number; gzipKb: number; forbidden: string[] };
const analyze = analyzeInitialBundle as (dist: string) => Result;

function dist(sourcesOfEntry: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><script type="module" src="/assets/index.js"></script><link rel="modulepreload" href="/assets/vendor.js"></html>',
  );
  writeFileSync(join(dir, 'assets', 'index.js'), 'console.log(1)');
  writeFileSync(join(dir, 'assets', 'vendor.js'), 'console.log(2)');
  writeFileSync(join(dir, 'assets', 'index.js.map'), JSON.stringify({ sources: sourcesOfEntry }));
  // chunk lười không được index.html tham chiếu: nguồn catalog ở đây là hợp lệ.
  writeFileSync(join(dir, 'assets', 'catalog.js'), 'console.log(3)');
  writeFileSync(
    join(dir, 'assets', 'catalog.js.map'),
    JSON.stringify({ sources: ['../../src/catalog/CatalogPage.tsx'] }),
  );
  return dir;
}

describe('check-web-bundle: gói khởi đầu', () => {
  it('sạch khi catalog/internal nằm ở chunk lười', () => {
    const r = analyze(dist(['../../src/main.tsx', '../../src/ui/button/Button.tsx']));
    expect(r.chunks).toBe(2);
    expect(r.forbidden).toEqual([]);
  });
  it('báo khi gói khởi đầu chứa danh mục', () => {
    expect(analyze(dist(['../../src/catalog/CatalogPage.tsx'])).forbidden).toHaveLength(1);
  });
  it('báo khi gói khởi đầu chứa khu vực nội bộ', () => {
    expect(analyze(dist(['../../src/internal/Support.tsx'])).forbidden).toHaveLength(1);
  });
});
