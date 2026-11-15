// pnpm wiki:check – kiểm tra wiki tra cứu `docs/wiki/` theo schema trong AGENTS.md:
// frontmatter đủ trường, `sources` trỏ tới tệp tồn tại, link nội bộ không gãy,
// mọi trang có trong index.md, log.md đúng tiền tố mục.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = ['feature', 'module', 'concept', 'decision', 'howto', 'glossary', 'open-questions'];
const STATUSES = ['draft', 'current', 'stale'];
const REQUIRED = ['type', 'title', 'sources', 'updated', 'status'];
const LOG_HEADING = /^## \[\d{4}-\d{2}-\d{2}\] (ingest|query|lint) \| .+/;
const EXEMPT = new Set(['index.md', 'log.md']);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Đọc frontmatter dạng `key: value` / `key: [a, b]`; trả null nếu không có khối `---`. */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  // Prettier có thể ngắt giá trị dài thành nhiều dòng thụt lề: nối lại thành một dòng.
  const lines = [];
  for (const line of m[1].split(/\r?\n/)) {
    if (/^\s+\S/.test(line) && lines.length > 0) lines[lines.length - 1] += ' ' + line.trim();
    else lines.push(line);
  }
  const data = {};
  for (const line of lines) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const raw = kv[2].replace(/\s+#.*$/, '').trim();
    data[kv[1]] =
      raw.startsWith('[') && raw.endsWith(']')
        ? raw
            .slice(1, -1)
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        : raw;
  }
  return data;
}

function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

export function checkWiki({ root = process.cwd() } = {}) {
  const wikiDir = join(root, 'docs', 'wiki');
  const errors = [];
  const err = (file, message) =>
    errors.push({ file: relative(root, file).split(sep).join('/'), message });
  if (!existsSync(wikiDir))
    return { errors: [{ file: 'docs/wiki', message: 'thiếu thư mục wiki' }], pages: 0 };

  const files = walk(wikiDir);
  const indexPath = join(wikiDir, 'index.md');
  const logPath = join(wikiDir, 'log.md');
  const index = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  if (!existsSync(indexPath)) err(indexPath, 'thiếu index.md');

  // index.md phải link tới mọi trang
  const indexTargets = new Set(
    [...stripCode(index).matchAll(/\]\(([^)#\s]+)/g)].map((x) => resolve(dirname(indexPath), x[1])),
  );

  for (const file of files) {
    const base = relative(wikiDir, file).split(sep).join('/');
    const text = readFileSync(file, 'utf8');
    if (!EXEMPT.has(base)) {
      const fm = parseFrontmatter(text);
      if (!fm) err(file, 'thiếu frontmatter');
      else {
        for (const key of REQUIRED)
          if (fm[key] === undefined || fm[key] === '') err(file, `frontmatter thiếu "${key}"`);
        if (fm.type && !TYPES.includes(fm.type)) err(file, `type không hợp lệ: ${fm.type}`);
        if (fm.status && !STATUSES.includes(fm.status))
          err(file, `status không hợp lệ: ${fm.status}`);
        if (fm.updated && !/^\d{4}-\d{2}-\d{2}$/.test(fm.updated))
          err(file, `updated sai định dạng: ${fm.updated}`);
        const sources = Array.isArray(fm.sources) ? fm.sources : fm.sources ? [fm.sources] : [];
        for (const s of sources) {
          const p = s.replace(/^['"]|['"]$/g, '').replace(/:\d+(-\d+)?$/, '');
          if (!existsSync(join(root, p))) err(file, `sources trỏ tới tệp không tồn tại: ${s}`);
        }
        const related = Array.isArray(fm.related) ? fm.related : [];
        for (const r of related) {
          if (!existsSync(join(wikiDir, r))) err(file, `related trỏ tới trang không tồn tại: ${r}`);
        }
      }
      if (!indexTargets.has(resolve(file))) err(file, 'chưa có trong index.md');
    }
    // link Markdown tương đối
    for (const m of stripCode(text).matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1].split('#')[0];
      if (!href || /^[a-z]+:/i.test(href) || href.startsWith('/')) continue;
      if (!existsSync(resolve(dirname(file), href))) err(file, `link gãy: ${m[1]}`);
    }
  }

  if (existsSync(logPath)) {
    for (const [i, line] of readFileSync(logPath, 'utf8').split(/\r?\n/).entries()) {
      if (line.startsWith('## ') && !LOG_HEADING.test(line))
        err(
          logPath,
          `dòng ${i + 1}: tiêu đề log sai định dạng "## [YYYY-MM-DD] ingest|query|lint | tiêu đề"`,
        );
    }
  } else err(logPath, 'thiếu log.md');

  return { errors, pages: files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, pages } = checkWiki();
  if (errors.length === 0) {
    console.log(`✔ wiki:check: ${pages} trang hợp lệ`);
  } else {
    console.error(`wiki:check: ${errors.length} lỗi`);
    for (const e of errors) console.error(`  ${e.file}: ${e.message}`);
    process.exit(1);
  }
}
