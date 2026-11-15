// node tooling/sync-design-tokens.mjs – đồng bộ apps/web/src/styles/figma-tokens.json → khối @theme của tokens.css
// (011 R12, FR-002). Nguồn duy nhất của màu/cỡ chữ/khoảng cách là JSON; chạy lại không đổi tệp nếu JSON không đổi.
// Chỉ ghi phần giữa BEGIN/END; mọi thứ ngoài hai dấu mốc là của người viết tay.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BEGIN = '/* BEGIN figma-tokens – sinh bởi tooling/sync-design-tokens.mjs, KHÔNG sửa tay */';
export const END = '/* END figma-tokens */';

const px = (n) => `${String(n)}px`;
const ms = (n) => `${String(n)}ms`;

/** Dựng khối @theme từ nội dung figma-tokens.json (hàm thuần – dễ kiểm thử). */
export function buildThemeBlock(tokens) {
  const lines = [
    '@theme static {',
    '  /* Đặt lại bảng mặc định của Tailwind: chỉ dùng được giá trị của Figma. */',
    '  --color-*: initial;',
    '  --text-*: initial;',
    '  --spacing-*: initial;',
    '  --radius-*: initial;',
    '  --shadow-*: initial;',
    '  --breakpoint-*: initial;',
    '',
    `  --font-sans: ${tokens.fontFamily};`,
    '',
  ];
  for (const [name, hex] of Object.entries(tokens.colors)) lines.push(`  --color-${name}: ${hex};`);
  lines.push('');
  for (const [name, t] of Object.entries(tokens.fontSizes)) {
    lines.push(`  --text-${name}: ${px(t.size)};`);
    lines.push(`  --text-${name}--line-height: ${px(t.lineHeight)};`);
    lines.push(`  --text-${name}--font-weight: ${String(t.weight)};`);
  }
  lines.push('');
  for (const [name, v] of Object.entries(tokens.spacing)) lines.push(`  --spacing-${name}: ${px(v)};`);
  for (const [name, v] of Object.entries(tokens.sizes)) lines.push(`  --spacing-${name}: ${px(v)};`);
  lines.push('');
  for (const [name, v] of Object.entries(tokens.radius)) lines.push(`  --radius-${name}: ${px(v)};`);
  lines.push('');
  for (const [name, v] of Object.entries(tokens.breakpoints)) lines.push(`  --breakpoint-${name}: ${px(v)};`);
  lines.push('');
  for (const [name, v] of Object.entries(tokens.motion)) {
    lines.push(`  --${name}: ${typeof v === 'number' ? ms(v) : v};`);
  }
  lines.push('}');
  return `${BEGIN}\n${lines.join('\n')}\n${END}`;
}

const HEADER = `/* Giá trị thiết kế của ứng dụng (011, FR-002). Phần giữa BEGIN/END sinh từ figma-tokens.json. */\n`;

/** Trả về nội dung tokens.css mới. `current` là nội dung hiện có (hoặc undefined nếu chưa có tệp). */
export function applyBlock(current, block) {
  if (current === undefined) return `${HEADER}\n${block}\n`;
  const start = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('tokens.css thiếu cặp dấu mốc BEGIN/END figma-tokens');
  }
  return `${current.slice(0, start)}${block}${current.slice(end + END.length)}`;
}

export function syncDesignTokens(root = join(dirname(fileURLToPath(import.meta.url)), '..')) {
  const dir = join(root, 'apps', 'web', 'src', 'styles');
  const jsonPath = join(dir, 'figma-tokens.json');
  const cssPath = join(dir, 'tokens.css');
  const tokens = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const current = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : undefined;
  const next = applyBlock(current, buildThemeBlock(tokens));
  if (next === current) return { changed: false, path: cssPath };
  mkdirSync(dir, { recursive: true });
  writeFileSync(cssPath, next);
  return { changed: true, path: cssPath };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { changed, path } = syncDesignTokens();
  console.log(changed ? `✓ Đã cập nhật ${path}` : '✓ tokens.css đã khớp figma-tokens.json');
}
