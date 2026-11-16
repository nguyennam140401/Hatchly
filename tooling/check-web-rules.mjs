// pnpm check:web-rules – quy tắc kỷ luật giao diện cho apps/web/src (011, FR-005, FR-032, SC-002):
//   1. không màu viết cứng (#hex, rgb(, hsl() ngoài styles/;
//   2. không style={{…}} mang màu/cỡ chữ/khoảng cách/kích thước (dùng token Tailwind; giá trị động qua biến CSS tùy chỉnh);
//   3. không giá trị tùy ý kiểu w-[300px], bg-[#fff] trong chuỗi className;
//   4. khu vực khách hàng (mọi nơi trừ internal/) không định dạng tiền (USD, $, đ, VND, micro-USD) – hiến pháp III.
// Cho phép ngoại lệ có lý do bằng chú thích `web-rules-ignore: <lý do>` ở cùng dòng hoặc dòng ngay trên.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const IGNORE_MARK = 'web-rules-ignore:';

const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\brgba?\(|\bhsla?\(/;
const ARBITRARY_RE =
  /(?<![\w-])[a-z][\w-]*-\[(?:#|-?\d)[^\]\s]*\]|(?<![\w-])[a-z][\w-]*-\[[^\]\s]*(?:px|rem|em|vh|vw|%)\]/;
const STYLE_KEY_RE =
  /^(?:color|background\w*|font\w*|line-?height|margin\w*|padding\w*|gap|row-?gap|column-?gap|width|height|min\w+|max\w+|border\w*|top|left|right|bottom|inset\w*|fill|stroke|letter-?spacing)$/i;
const MONEY_RES = [
  [/\$\s?\d/, '$ đi kèm số'],
  [/\bUSD\b/i, 'USD'],
  [/\d\s?(?:đ|₫|VND)(?![\p{L}])/iu, 'số tiền VND'],
  [/\b(?:VND|USD)\s?\d/i, 'tiền tệ đi kèm số'],
  [/micro[-_ ]?usd/i, 'micro-USD'],
];

/** Thay chú thích bằng khoảng trắng nhưng giữ nguyên số dòng. */
export function stripComments(source) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
    } else if (c === '/' && n === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      i += 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/** Khối `style={{ … }}` (đến `}}` khớp ngoặc). */
function* styleBlocks(text) {
  const re = /style=\{\{/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 2;
    let i = m.index + m[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
      i += 1;
    }
    yield { index: m.index, body: text.slice(start, i - 2) };
  }
}

/** Quét một tệp, trả về danh sách vi phạm `{ line, rule, message }`. */
export function scanSource(raw, { customerArea }) {
  const rawLines = raw.split('\n');
  const text = stripComments(raw);
  const lines = text.split('\n');
  const found = [];
  const ignored = (line) =>
    (rawLines[line - 1] ?? '').includes(IGNORE_MARK) ||
    (rawLines[line - 2] ?? '').includes(IGNORE_MARK);
  const add = (line, rule, message) => {
    if (!ignored(line)) found.push({ line, rule, message });
  };

  lines.forEach((l, idx) => {
    const line = idx + 1;
    if (COLOR_RE.test(l))
      add(line, 'hard-coded-color', 'màu viết cứng – dùng token (bg-brand, text-ink…)');
    if (ARBITRARY_RE.test(l))
      add(line, 'arbitrary-value', 'giá trị tùy ý trong className – dùng token/thang khoảng cách');
    if (customerArea) {
      for (const [re, what] of MONEY_RES) {
        if (re.test(l))
          add(
            line,
            'money-format',
            `định dạng tiền (${what}) ở khu vực khách hàng – chỉ hiện % (FR-032)`,
          );
      }
    }
  });

  for (const block of styleBlocks(text)) {
    const keys = [...block.body.matchAll(/(?:^|[,{\s])(['"]?)([A-Za-z-][\w-]*)\1\s*:/g)].map(
      (k) => k[2],
    );
    const bad = keys.filter((k) => !k.startsWith('--') && STYLE_KEY_RE.test(k));
    if (bad.length > 0) {
      add(
        lineOf(text, block.index),
        'inline-style',
        `style={{}} có ${bad.join(', ')} – dùng lớp Tailwind; giá trị động qua biến '--x'`,
      );
    }
  }
  return found;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

export function checkWebRules({
  root = join(dirname(fileURLToPath(import.meta.url)), '..'),
  scope,
} = {}) {
  const src = join(root, 'apps', 'web', 'src');
  const base = scope ? join(root, scope) : src;
  const violations = [];
  let files = 0;
  try {
    statSync(base);
  } catch {
    return { violations, files };
  }
  for (const file of walk(base)) {
    const rel = relative(src, file).split(sep).join('/');
    if (!/\.(tsx?|jsx?)$/.test(rel)) continue;
    if (/\.spec\.[tj]sx?$/.test(rel) || /(^|\/)__tests__\//.test(rel) || /\.d\.ts$/.test(rel))
      continue;
    if (rel.startsWith('styles/')) continue;
    files += 1;
    const customerArea = !rel.startsWith('internal/');
    for (const v of scanSource(readFileSync(file, 'utf8'), { customerArea })) {
      violations.push({ file: `apps/web/src/${rel}`, ...v });
    }
  }
  return { violations, files };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const scope = process.argv[2];
  const { violations, files } = checkWebRules({ scope });
  if (violations.length > 0) {
    console.error(
      `✗ check-web-rules: ${String(violations.length)} vi phạm trong ${String(files)} tệp:`,
    );
    for (const v of violations)
      console.error(`  ${v.file}:${String(v.line)} [${v.rule}] ${v.message}`);
    process.exit(1);
  }
  console.log(`✓ check-web-rules: ${String(files)} tệp, 0 vi phạm.`);
}
