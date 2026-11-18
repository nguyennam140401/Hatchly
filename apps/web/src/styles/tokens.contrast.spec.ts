import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRAST_PAIRS, contrastRatio, NON_TEXT_COLORS } from './tokens.contrast';

// FR-004: đọc tokens.css thật; cặp chữ < 4,5:1 hoặc viền/biểu tượng < 3:1 làm kiểm thử thất bại.
const css = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');

function colorOf(name: string): string {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6});`).exec(css);
  if (!m?.[1]) throw new Error(`tokens.css thiếu --color-${name}`);
  return m[1];
}

describe('tương phản màu (WCAG 2.1 AA)', () => {
  for (const pair of CONTRAST_PAIRS) {
    const min = pair.kind === 'text' ? 4.5 : 3;
    it(`${pair.fg} trên ${pair.bg} ≥ ${String(min)}:1`, () => {
      expect(contrastRatio(colorOf(pair.fg), colorOf(pair.bg))).toBeGreaterThanOrEqual(min);
    });
  }

  it('khớp số liệu đã tính trong figma-extract (success/success-soft 4,62)', () => {
    expect(contrastRatio(colorOf('success'), colorOf('success-soft'))).toBeCloseTo(4.62, 1);
  });

  it('spark không đủ cho chữ (2,47:1) nên chỉ làm mảng màu', () => {
    for (const name of NON_TEXT_COLORS) {
      expect(contrastRatio(colorOf(name), colorOf('surface-0'))).toBeLessThan(3);
      expect(CONTRAST_PAIRS.some((p) => p.fg === name)).toBe(false);
    }
  });
});

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

describe('cấm lớp text-spark', () => {
  it('không tệp nguồn nào dùng text-spark (spark chỉ làm nền/mảng màu)', () => {
    const src = join(import.meta.dirname, '..');
    const offenders = [...walk(src)]
      .filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith('tokens.contrast.spec.ts'))
      .filter((f) => /(^|[^-\w])text-spark([^-\w]|$)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
