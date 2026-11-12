// Quy tắc `no-cross-schema-sql` (006 research R16, cổng CI số 3 của hiến pháp): mã của module <m> chỉ
// được nhắc tới schema CỦA CHÍNH NÓ trong câu SQL. Quy tắc import (dependency-cruiser) không bắt được
// SQL viết tay, và RLS không chặn được vì cùng tenant.
// Quét tĩnh `apps/server/src/modules/<m>/**/*.ts` (không quét core/): lấy nội dung chuỗi/template
// trông như SQL (template gắn thẻ `sql` hoặc có từ khóa SELECT/INSERT/UPDATE/DELETE/FROM/JOIN/INTO),
// tìm `"<schema>"."<bảng>"` hoặc `<schema>.<bảng>` (không tính lời gọi hàm `schema.fn(`) với <schema> là
// schema của module KHÁC theo modules.manifest.json.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SQL_KEYWORDS = /\b(select|insert|update|delete|from|join|into)\b/i;

/** Các đoạn chuỗi trong mã nguồn (bỏ chú thích): { text, offset, tagged }. */
function stringLiterals(source) {
  const out = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const start = i;
      const tagged = c === '`' && /\bsql\s*$/.test(source.slice(Math.max(0, i - 8), i));
      i++;
      let text = '';
      while (i < n && source[i] !== c) {
        if (source[i] === '\\') {
          text += source[i + 1] ?? '';
          i += 2;
          continue;
        }
        // `${…}` trong template: thay bằng chỗ trống (biểu thức không phải văn bản SQL).
        if (c === '`' && source[i] === '$' && source[i + 1] === '{') {
          let depth = 1;
          i += 2;
          while (i < n && depth > 0) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') depth--;
            i++;
          }
          text += ' ? ';
          continue;
        }
        text += source[i];
        i++;
      }
      out.push({ text, offset: start, tagged });
      i++;
      continue;
    }
    i++;
  }
  return out;
}

function tsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...tsFiles(full));
    else if (entry.endsWith('.ts')) files.push(full);
  }
  return files;
}

/**
 * Vi phạm trong một gốc kho (`baseDir` chứa apps/server/src/modules/modules.manifest.json).
 * @returns {{ file: string, line: number, module: string, schema: string, ref: string }[]}
 */
export function findCrossSchemaSql(baseDir) {
  const modulesDir = join(baseDir, 'apps', 'server', 'src', 'modules');
  const manifestPath = join(modulesDir, 'modules.manifest.json');
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const schemaOf = new Map(manifest.modules.map((m) => [m.name, m.schema]));
  const allSchemas = [...new Set(manifest.modules.map((m) => m.schema))];
  const violations = [];
  for (const mod of manifest.modules) {
    const dir = join(modulesDir, mod.name);
    if (!existsSync(dir)) continue;
    const others = allSchemas.filter((s) => s !== schemaOf.get(mod.name));
    if (others.length === 0) continue;
    const pattern = new RegExp(
      `(?<![\\w.])"?(${others.join('|')})"?\\s*\\.\\s*"?([a-z_][a-z0-9_]*)(?![a-z0-9_])"?(?!\\s*\\()`,
      'g',
    );
    for (const file of tsFiles(dir)) {
      const source = readFileSync(file, 'utf8');
      for (const lit of stringLiterals(source)) {
        // Chuỗi một từ (vd tên quyền 'account.delete') không phải câu SQL.
        if (!lit.tagged && !(/\s/.test(lit.text.trim()) && SQL_KEYWORDS.test(lit.text))) continue;
        for (const m of lit.text.matchAll(pattern)) {
          const line = source.slice(0, lit.offset).split('\n').length;
          violations.push({
            file: relative(baseDir, file).replace(/\\/g, '/'),
            line,
            module: mod.name,
            schema: m[1],
            ref: `${m[1]}.${m[2]}`,
          });
        }
      }
    }
  }
  return violations;
}

/** Thông điệp tiếng Việt cho một vi phạm. */
export function formatCrossSchemaViolation(v) {
  return `  ✖ no-cross-schema-sql: ${v.file}:${v.line} – module "${v.module}" truy cập "${v.ref}" thuộc schema "${v.schema}" của module khác (chỉ được gọi qua giao diện công khai của module đó)`;
}
