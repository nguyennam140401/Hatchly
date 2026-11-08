// pnpm db:lint-migrations – quét migration SQL MỚI tìm câu lệnh phá tương thích ngược (FR-012, R17).
// Bản API/Worker cũ và mới chạy song song khi phát hành → không DROP/RENAME/đổi kiểu/SET NOT NULL
// trên cấu trúc đang dùng, trừ khi có chú thích `-- breaking-ok: <lý do + lần phát hành thứ hai>`
// ngay dòng trên câu lệnh. Quy trình mở rộng → chuyển → thu gọn: apps/server/docs/database.md.
//
// Dùng: tsx src/db/lint-migrations.ts [tệp.sql ...]
//   không có tệp: các tệp mới so với nhánh gốc (MIGRATION_BASE_REF, mặc định main) + tệp chưa theo
//   dõi; không có git → mọi tệp trong drizzle/migrations.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { DRIZZLE_DIR } from './script-utils';

export interface MigrationViolation {
  file: string;
  line: number;
  statement: string;
  reason: string;
}

interface Statement {
  text: string;
  line: number;
}

/** Tách câu lệnh SQL, bỏ qua `;` trong chuỗi, chú thích và thân hàm `$tag$ … $tag$`. */
export function splitStatements(sqlText: string): Statement[] {
  const out: Statement[] = [];
  let current = '';
  let startLine = 1;
  let line = 1;
  let started = false;
  let i = 0;
  const push = () => {
    if (current.trim() !== '') out.push({ text: current.trim(), line: startLine });
    current = '';
    started = false;
  };
  while (i < sqlText.length) {
    const ch = sqlText.charAt(i);
    const rest = sqlText.slice(i);
    if (rest.startsWith('--')) {
      const end = sqlText.indexOf('\n', i);
      i = end === -1 ? sqlText.length : end;
      continue;
    }
    if (!started && !/\s/.test(ch)) {
      started = true;
      startLine = line;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sqlText.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sqlText.length : end + tag.length;
      const chunk = sqlText.slice(i, stop);
      current += chunk;
      line += chunk.split('\n').length - 1;
      i = stop;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < sqlText.length && !(sqlText[j] === "'" && sqlText[j + 1] !== "'")) {
        j += sqlText[j] === "'" ? 2 : 1;
      }
      const chunk = sqlText.slice(i, j + 1);
      current += chunk;
      line += chunk.split('\n').length - 1;
      i = j + 1;
      continue;
    }
    if (ch === ';') {
      push();
      i++;
      continue;
    }
    if (ch === '\n') line++;
    current += ch;
    i++;
  }
  push();
  return out;
}

const IDENT = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_]*)`;
const QUALIFIED = String.raw`(${IDENT}(?:\.${IDENT})?)`;
const norm = (name: string) => name.replace(/"/g, '').toLowerCase();

const RULES: { pattern: RegExp; reason: string; newTableSafe: boolean }[] = [
  { pattern: /\bDROP\s+SCHEMA\b/i, reason: 'xóa schema', newTableSafe: false },
  { pattern: /\bDROP\s+TABLE\b/i, reason: 'xóa bảng', newTableSafe: false },
  { pattern: /\bDROP\s+COLUMN\b/i, reason: 'xóa cột', newTableSafe: true },
  { pattern: /\bRENAME\b/i, reason: 'đổi tên', newTableSafe: true },
  {
    pattern: /\bALTER\s+COLUMN\s+\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
    reason: 'đổi kiểu cột',
    newTableSafe: true,
  },
  {
    pattern: /\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i,
    reason: 'SET NOT NULL trên cột có sẵn (cần backfill trước, phát hành riêng)',
    newTableSafe: true,
  },
];

/** Kiểm một tệp SQL. `displayName` dùng trong báo cáo. */
export function lintMigrationSql(sqlText: string, displayName: string): MigrationViolation[] {
  const statements = splitStatements(sqlText);
  const lines = sqlText.split(/\r?\n/);
  const createdTables = new Set<string>();
  for (const s of statements) {
    const m = new RegExp(
      String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${QUALIFIED}`,
      'i',
    ).exec(s.text);
    if (m?.[1]) createdTables.add(norm(m[1]));
  }

  const violations: MigrationViolation[] = [];
  for (const s of statements) {
    // Thân hàm `$tag$ … $tag$` và chuỗi '...' không phải câu migration – bỏ trước khi đối chiếu.
    const bare = s.text
      .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, '$$$$')
      .replace(/'(?:[^']|'')*'/g, "''");
    const rule = RULES.find((r) => r.pattern.test(bare));
    if (!rule) continue;
    if (rule.newTableSafe) {
      const target = new RegExp(
        String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${QUALIFIED}`,
        'i',
      ).exec(s.text);
      if (target?.[1] && createdTables.has(norm(target[1]))) continue;
    }
    const above = (lines[s.line - 2] ?? '').trim();
    if (/^--\s*breaking-ok:\s*\S/.test(above)) continue;
    violations.push({
      file: displayName,
      line: s.line,
      statement: s.text.replace(/\s+/g, ' ').slice(0, 80),
      reason: rule.reason,
    });
  }
  return violations;
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** Tệp migration mới so với nhánh gốc (hoặc mọi tệp khi không có git). */
export function newMigrationFiles(): string[] {
  const folder = join(DRIZZLE_DIR, 'migrations');
  try {
    const root = git(['rev-parse', '--show-toplevel']);
    const base = process.env.MIGRATION_BASE_REF ?? 'main';
    const mergeBase = git(['merge-base', 'HEAD', base]);
    const rel = relative(root, folder).replace(/\\/g, '/');
    const added = git(['diff', '--name-only', '--diff-filter=A', mergeBase, '--', rel]);
    const untracked = git(['ls-files', '--others', '--exclude-standard', '--', rel]);
    return [...added.split('\n'), ...untracked.split('\n')]
      .filter((f) => f.endsWith('.sql'))
      .map((f) => resolve(root, f));
  } catch {
    return readdirSync(folder)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => join(folder, f));
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args.map((f) => resolve(f)) : newMigrationFiles();
  const violations = files.flatMap((file) =>
    lintMigrationSql(readFileSync(file, 'utf8'), relative(process.cwd(), file)),
  );
  console.log(`Kiểm tra migration tương thích ngược – ${files.length} tệp`);
  for (const v of violations) {
    console.log(`${v.file}:${v.line}  ${v.statement}  ${v.reason}`);
  }
  if (violations.length > 0) {
    console.log(
      `→ THẤT BẠI: ${violations.length} câu lệnh phá tương thích ngược. Tách thành mở rộng → chuyển → thu gọn, hoặc thêm "-- breaking-ok: <lý do>" ngay dòng trên.`,
    );
    process.exit(1);
  }
  console.log('→ ĐẠT: 0 vi phạm');
}

if (require.main === module) main();
