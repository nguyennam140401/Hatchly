// Danh sách cặp (chữ/biểu tượng, nền) được phép dùng cùng nhau (FR-004, WCAG 2.1 AA).
// tokens.contrast.spec.ts đọc tokens.css và thất bại nếu cặp chữ < 4,5:1 hoặc viền/biểu tượng < 3:1.
// Thêm màu mới vào figma-tokens.json mà dùng làm chữ → phải thêm cặp ở đây.

export interface ContrastPair {
  readonly fg: string;
  readonly bg: string;
  /** `text` cần ≥ 4,5:1; `ui` (viền, biểu tượng, thành phần giao diện) cần ≥ 3:1. */
  readonly kind: 'text' | 'ui';
}

const textOn = (bg: string, ...fgs: string[]): ContrastPair[] =>
  fgs.map((fg) => ({ fg, bg, kind: 'text' as const }));

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...textOn('surface-0', 'ink', 'ink-muted', 'brand', 'success', 'warning', 'danger', 'info'),
  ...textOn('surface-100', 'ink', 'ink-muted', 'brand'),
  ...textOn('surface-200', 'ink', 'ink-muted'),
  ...textOn('brand', 'on-brand'),
  ...textOn('brand-strong', 'on-brand'),
  ...textOn('brand-soft', 'brand', 'ink'),
  ...textOn('success-soft', 'success'),
  ...textOn('warning-soft', 'warning'),
  ...textOn('danger-soft', 'danger'),
  ...textOn('info-soft', 'info'),
  ...textOn('spark-soft', 'spark-ink'),
  { fg: 'line-strong', bg: 'surface-0', kind: 'ui' },
  { fg: 'line-strong', bg: 'surface-100', kind: 'ui' },
  { fg: 'brand', bg: 'surface-0', kind: 'ui' },
];

/** Màu chỉ làm mảng màu, KHÔNG làm chữ (FR-004): spark 2,47:1 trên trắng. */
export const NON_TEXT_COLORS: readonly string[] = ['spark'];

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`Màu không hợp lệ: ${hex}`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
