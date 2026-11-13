// pnpm db:immutable – migration đã có ở nhánh gốc là BẤT BIẾN (008, FR-019, R11).
// "Đã áp dụng lên môi trường" được hiểu là "đã có trên dev hoặc master", vì hợp nhất vào dev là triển
// khai ngay. Sửa một tệp đã áp không làm CSDL đổi theo (bộ chạy migration chỉ áp tệp chưa ghi trong nhật
// ký) → môi trường và mã lệch nhau âm thầm. Muốn sửa: viết migration MỚI.
//
// Kiểm (so điểm rẽ nhánh với nhánh gốc ↔ cây làm việc hiện tại):
//   - tệp trong drizzle/migrations/** đã có ở nhánh gốc không được sửa / xóa / đổi tên;
//   - meta/_journal.json chỉ được NỐI THÊM vào cuối (các mục cũ giữ nguyên, đúng thứ tự);
//   - mốc `when` của mục mới phải lớn hơn mọi mục đã có ở đầu nhánh gốc (nếu không sẽ bị bỏ qua âm thầm).
// Nhánh gốc: MIGRATION_BASE_REF (mặc định origin/dev). Không có nhánh gốc (kho mới) → NOT_APPLICABLE.
//
// Dùng: tsx src/db/check-immutable.ts
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { migrationBaseRef } from './lint-migrations';
import { DRIZZLE_DIR } from './script-utils';

export interface ImmutableViolation {
  file: string;
  problem: string;
}

export type ImmutableResult =
  | { status: 'not_applicable'; note: string }
  | { status: 'ok'; checked: number }
  | { status: 'failed'; violations: ImmutableViolation[] };

interface Journal {
  entries?: unknown[];
  [key: string]: unknown;
}

interface JournalEntry {
  tag: string;
  when: number;
}

const JOURNAL = 'meta/_journal.json';

/**
 * @param cwd thư mục bất kỳ trong kho git cần kiểm
 * @param baseRef nhánh gốc (vd `origin/dev`)
 * @param folder thư mục migration, tính từ gốc kho (vd `apps/server/drizzle/migrations`)
 */
export function checkImmutable(cwd: string, baseRef: string, folder: string): ImmutableResult {
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const tryGit = (args: string[]): string | undefined => {
    try {
      return git(args);
    } catch {
      return undefined;
    }
  };

  if (tryGit(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]) === undefined) {
    return { status: 'not_applicable', note: `không có nhánh gốc ${baseRef} (kho mới)` };
  }
  const mergeBase = tryGit(['merge-base', 'HEAD', baseRef])?.trim();
  if (mergeBase === undefined || mergeBase === '') {
    return { status: 'not_applicable', note: `HEAD không chung lịch sử với ${baseRef}` };
  }
  const root = git(['rev-parse', '--show-toplevel']).trim();

  const atBase = git(['ls-tree', '-r', '--name-only', mergeBase, '--', folder])
    .split('\n')
    .filter((f) => f !== '');
  if (atBase.length === 0) {
    return { status: 'not_applicable', note: `nhánh gốc ${baseRef} chưa có migration nào` };
  }

  const violations: ImmutableViolation[] = [];
  // --no-renames: đổi tên hiện ra thành "xóa tệp cũ + thêm tệp mới" → tệp cũ bị báo.
  const changed = git(['diff', '--name-status', '--no-renames', mergeBase, '--', folder])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [status = '', file = ''] = line.split('\t');
      return { status, file };
    });
  const journalPath = `${folder}/${JOURNAL}`;
  for (const { status, file } of changed) {
    if (status === 'A') continue;
    if (file === journalPath && status === 'M') continue;
    violations.push({
      file,
      problem:
        status === 'D'
          ? 'đã có ở nhánh gốc nhưng bị xóa hoặc đổi tên'
          : 'đã có ở nhánh gốc nhưng bị sửa nội dung',
    });
  }

  // Nhật ký chỉ được nối thêm vào cuối.
  const baseJournalText = tryGit(['show', `${mergeBase}:${journalPath}`]);
  const currentJournalFile = join(root, journalPath);
  if (baseJournalText !== undefined && existsSync(currentJournalFile)) {
    const before = JSON.parse(baseJournalText) as Journal;
    let after: Journal | undefined;
    try {
      after = JSON.parse(readFileSync(currentJournalFile, 'utf8')) as Journal;
    } catch {
      violations.push({ file: journalPath, problem: 'không phải JSON hợp lệ' });
    }
    if (after !== undefined) {
      const oldEntries = before.entries ?? [];
      const newEntries = after.entries ?? [];
      const firstDiff = oldEntries.findIndex(
        (entry, index) => !isDeepStrictEqual(entry, newEntries[index]),
      );
      if (firstDiff !== -1) {
        const tag = (oldEntries[firstDiff] as { tag?: string } | undefined)?.tag ?? `#${firstDiff}`;
        violations.push({
          file: journalPath,
          problem: `mục cũ "${tag}" (vị trí ${firstDiff}) bị sửa, xóa hoặc bị chèn mục khác lên trước – nhật ký chỉ được nối thêm vào cuối`,
        });
      }
      // Mốc `when` của migration mới phải LỚN HƠN mọi migration đã có ở đầu nhánh gốc: bộ chạy migration
      // bỏ qua âm thầm mục có mốc cũ hơn migration mới nhất đã áp (T021 – migration-order.db.spec.ts).
      // So với ĐẦU nhánh gốc (không phải điểm rẽ nhánh) để bắt ca "nhánh sinh migration trước lại hợp
      // nhất sau".
      const tipJournalText = tryGit(['show', `${baseRef}:${journalPath}`]);
      const tipEntries = ((tipJournalText === undefined
        ? before
        : (JSON.parse(tipJournalText) as Journal)
      ).entries ?? []) as JournalEntry[];
      const tipTags = new Set(tipEntries.map((e) => e.tag));
      const latest = tipEntries.reduce<JournalEntry | undefined>(
        (max, e) => (max === undefined || e.when > max.when ? e : max),
        undefined,
      );
      let previous = latest;
      for (const added of (newEntries as JournalEntry[]).filter((e) => !tipTags.has(e.tag))) {
        if (previous !== undefined && !(added.when > previous.when)) {
          violations.push({
            file: journalPath,
            problem:
              `migration mới "${added.tag}" có mốc when (${added.when}) không lớn hơn "${previous.tag}" ` +
              `(${previous.when}) → sẽ bị bỏ qua âm thầm trên CSDL đã áp "${previous.tag}". ` +
              `Hợp nhất ${baseRef} vào nhánh rồi đặt when của mục mới thành thời điểm hiện tại (Date.now())`,
          });
        } else previous = added;
      }
      const withoutEntries = (j: Journal) => ({ ...j, entries: undefined });
      if (!isDeepStrictEqual(withoutEntries(before), withoutEntries(after))) {
        violations.push({
          file: journalPath,
          problem: 'phần đầu nhật ký (version/dialect) bị sửa',
        });
      }
    }
  }

  return violations.length > 0
    ? { status: 'failed', violations }
    : { status: 'ok', checked: atBase.length };
}

function main(): void {
  const baseRef = migrationBaseRef();
  let root: string;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    console.log('NOT_APPLICABLE: không phải kho git');
    return;
  }
  const folder = relative(root, join(DRIZZLE_DIR, 'migrations')).replace(/\\/g, '/');
  const result = checkImmutable(root, baseRef, folder);
  if (result.status === 'not_applicable') {
    console.log(`NOT_APPLICABLE: ${result.note}`);
    return;
  }
  console.log(`Kiểm tra migration bất biến – so với ${baseRef}`);
  if (result.status === 'ok') {
    console.log(`→ ĐẠT: ${result.checked} tệp đã có ở nhánh gốc còn nguyên`);
    return;
  }
  for (const v of result.violations) console.log(`✖ ${v.file} – ${v.problem}`);
  console.log(
    `→ THẤT BẠI: ${result.violations.length} vi phạm. Migration đã có ở ${baseRef} không được sửa – khôi phục tệp và viết migration mới.`,
  );
  process.exit(1);
}

if (require.main === module) main();
