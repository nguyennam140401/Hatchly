// pnpm db:lint-migrations – quét migration SQL MỚI tìm câu lệnh phá tương thích ngược (FR-012, R17).
// Bản API/Worker cũ và mới chạy song song khi phát hành → không DROP/RENAME/đổi kiểu/SET NOT NULL
// trên cấu trúc đang dùng, trừ khi có chú thích `-- breaking-ok: <lý do + lần phát hành thứ hai>`
// ngay dòng trên câu lệnh. Quy trình mở rộng → chuyển → thu gọn: apps/server/docs/database.md.
//
// Dùng: tsx src/db/lint-migrations.ts [tệp.sql ...]
//   không có tệp: các tệp mới so với nhánh gốc (MIGRATION_BASE_REF, mặc định origin/dev) + tệp chưa theo
//   dõi; không có git → mọi tệp trong drizzle/migrations.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { DRIZZLE_DIR } from './script-utils';

export interface MigrationViolation {
  file: string;
  line: number;
  statement: string;
  /** Mã luật, vd `add-not-null-without-default`. */
  code: string;
  reason: string;
  /** Cách chia bước thay thế. */
  alternative: string;
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

interface Rule {
  /** Mã luật (ổn định – dùng trong báo cáo và tài liệu). */
  code: string;
  reason: string;
  /** Cách chia bước thay thế, in kèm mỗi vi phạm (008, FR-017). */
  alternative: string;
  /** Câu lệnh (đã bỏ chuỗi và thân hàm) có vi phạm không. */
  matches: (bare: string) => boolean;
  /** Bảng tạo trong chính tệp này thì không tính (chưa bản nào đang dùng). */
  newTableSafe: boolean;
}

const byPattern = (pattern: RegExp) => (bare: string) => pattern.test(bare);

/** Tách các mệnh đề của `ALTER TABLE … a, b, c` theo dấu phẩy ngoài ngoặc. */
function topLevelClauses(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else current += ch;
  }
  out.push(current);
  return out;
}

const EXPAND_CONTRACT =
  'tách hai lần phát hành: lần 1 ngừng dùng trong mã, lần 2 mới xóa/đổi (kèm "-- breaking-ok:")';

const RULES: Rule[] = [
  {
    code: 'drop-schema',
    matches: byPattern(/\bDROP\s+SCHEMA\b/i),
    reason: 'xóa schema',
    alternative: EXPAND_CONTRACT,
    newTableSafe: false,
  },
  {
    code: 'drop-table',
    matches: byPattern(/\bDROP\s+TABLE\b/i),
    reason: 'xóa bảng',
    alternative: EXPAND_CONTRACT,
    newTableSafe: false,
  },
  {
    code: 'drop-column',
    matches: byPattern(/\bDROP\s+COLUMN\b/i),
    reason: 'xóa cột',
    alternative: EXPAND_CONTRACT,
    newTableSafe: true,
  },
  {
    code: 'rename',
    matches: byPattern(/\bRENAME\b/i),
    reason: 'đổi tên',
    alternative:
      'thêm cột/bảng mới → ghi cả hai → chuyển dữ liệu → đổi mã sang tên mới → xóa tên cũ ở lần phát hành sau',
    newTableSafe: true,
  },
  {
    code: 'alter-column-type',
    matches: byPattern(/\bALTER\s+COLUMN\s+\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i),
    reason: 'đổi kiểu cột',
    alternative:
      'thêm cột mới kiểu mới → ghi cả hai → chuyển dữ liệu → đổi mã → xóa cột cũ ở lần phát hành sau',
    newTableSafe: true,
  },
  {
    code: 'set-not-null',
    matches: byPattern(/\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i),
    reason: 'SET NOT NULL trên cột có sẵn (cần backfill trước, phát hành riêng)',
    alternative:
      'lần 1: mã mới luôn ghi giá trị + backfill; lần 2: SET NOT NULL (kèm "-- breaking-ok:")',
    newTableSafe: true,
  },
  // ---- 008 (FR-017, R11) ----
  {
    code: 'add-not-null-without-default',
    matches: (bare) =>
      topLevelClauses(bare).some(
        (clause) =>
          /\bADD\s+COLUMN\b/i.test(clause) &&
          /\bNOT\s+NULL\b/i.test(clause) &&
          !/\bDEFAULT\b/i.test(clause) &&
          !/\bGENERATED\b/i.test(clause),
      ),
    reason: 'thêm cột NOT NULL không có DEFAULT (bản đang chạy không ghi cột này → INSERT lỗi)',
    alternative:
      'thêm cột kèm DEFAULT, hoặc thêm cột cho phép NULL → mã mới ghi + backfill → SET NOT NULL ở lần phát hành sau',
    newTableSafe: true,
  },
  {
    code: 'add-constraint-validating',
    matches: (bare) =>
      topLevelClauses(bare).some(
        (clause) =>
          /\bADD\s+(?:CONSTRAINT\s+\S+\s+)?(?:CHECK|FOREIGN\s+KEY|UNIQUE)\b/i.test(clause) &&
          !/\bNOT\s+VALID\b/i.test(clause) &&
          !/\bUSING\s+INDEX\b/i.test(clause),
      ),
    reason:
      'thêm ràng buộc CHECK/FK/UNIQUE trên bảng có sẵn (khóa bảng để quét; dữ liệu của bản đang chạy có thể vi phạm)',
    alternative:
      'CHECK/FK: ADD CONSTRAINT … NOT VALID rồi VALIDATE CONSTRAINT ở câu lệnh sau; UNIQUE: dựng chỉ mục duy nhất trước rồi ADD CONSTRAINT … UNIQUE USING INDEX',
    newTableSafe: true,
  },
  {
    code: 'create-index-blocking',
    matches: byPattern(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY\b)/i),
    reason: 'CREATE INDEX không CONCURRENTLY trên bảng có sẵn (chặn ghi trong lúc dựng chỉ mục)',
    alternative:
      'bảng lớn: CREATE INDEX CONCURRENTLY chạy ngoài giao dịch (thao tác vận hành riêng, rồi migration dùng IF NOT EXISTS); bảng còn nhỏ: giữ câu lệnh và khai báo "-- breaking-ok: bảng nhỏ, khóa ghi ngắn"',
    newTableSafe: true,
  },
  {
    code: 'drop-type',
    matches: byPattern(/\bDROP\s+TYPE\b/i),
    reason: 'xóa kiểu / bỏ giá trị enum (bản đang chạy còn ghi giá trị cũ)',
    alternative:
      'lần 1: mã ngừng ghi giá trị cũ + chuyển dữ liệu; lần 2: tạo lại kiểu (kèm "-- breaking-ok:")',
    newTableSafe: false,
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
    // Bảng đích của câu lệnh (ALTER TABLE … hoặc CREATE INDEX … ON …).
    const target =
      new RegExp(
        String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${QUALIFIED}`,
        'i',
      ).exec(s.text) ??
      new RegExp(
        String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\b[\s\S]*?\bON\s+(?:ONLY\s+)?${QUALIFIED}`,
        'i',
      ).exec(s.text);
    const onNewTable = target?.[1] !== undefined && createdTables.has(norm(target[1]));
    const rule = RULES.find((r) => r.matches(bare) && !(r.newTableSafe && onNewTable));
    if (!rule) continue;
    const above = (lines[s.line - 2] ?? '').trim();
    if (/^--\s*breaking-ok:\s*\S/.test(above)) continue;
    violations.push({
      file: displayName,
      line: s.line,
      statement: s.text.replace(/\s+/g, ' ').slice(0, 80),
      code: rule.code,
      reason: rule.reason,
      alternative: rule.alternative,
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

/**
 * Nhánh gốc để xác định migration "mới" (008, R11): Jenkins đặt `MIGRATION_BASE_REF=origin/<nhánh đích>`;
 * máy cá nhân mặc định `origin/dev` (mọi thay đổi đi qua `dev`).
 */
export function migrationBaseRef(env: Record<string, string | undefined> = process.env): string {
  const value = env.MIGRATION_BASE_REF?.trim();
  return value === undefined || value === '' ? 'origin/dev' : value;
}

/** Tệp migration mới so với nhánh gốc (hoặc mọi tệp khi không có git). */
export function newMigrationFiles(): string[] {
  const folder = join(DRIZZLE_DIR, 'migrations');
  try {
    const root = git(['rev-parse', '--show-toplevel']);
    const base = migrationBaseRef();
    const mergeBase = git(['merge-base', 'HEAD', base]);
    const rel = relative(root, folder).replace(/\\/g, '/');
    const added = git(['-C', root, 'diff', '--name-only', '--diff-filter=A', mergeBase, '--', rel]);
    const untracked = git(['-C', root, 'ls-files', '--others', '--exclude-standard', '--', rel]);
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
    console.log(`✖ ${v.file}:${v.line}  [${v.code}] ${v.reason}`);
    console.log(`    câu lệnh : ${v.statement}`);
    console.log(`    thay bằng: ${v.alternative}`);
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
