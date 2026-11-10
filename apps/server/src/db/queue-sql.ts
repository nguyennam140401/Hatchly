// pnpm queue:sql – in SQL dựng/nâng schema `pgboss` của bản pg-boss cố định (research R2, 003 T006).
//   --construct                 SQL dựng schema (dán vào migration tay 0005_pgboss_install.sql)
//   --migrate-from <version>    SQL nâng schema từ phiên bản cũ (lần nâng pg-boss sau)
// Mã thoát: 0 đạt · 1 sai tham số.
//
// pg-boss tự bọc SQL trong BEGIN … COMMIT. Migrator của Drizzle đã chạy MỌI migration trong một giao
// dịch, nên lệnh này bỏ cặp BEGIN/COMMIT ngoài cùng (COMMIT giữa chừng sẽ xác nhận nửa lô migration).
// Phần còn lại giữ NGUYÊN VĂN đầu ra của thư viện.

/** Tên schema của thư viện hàng chờ (thuật ngữ: "schema thư viện hàng chờ"). */
export const PGBOSS_SCHEMA = 'pgboss';

/** Bỏ dòng `BEGIN;` đầu và `COMMIT;` cuối do pg-boss thêm. */
export function stripOuterTransaction(sqlText: string): string {
  const lines = sqlText.split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first >= 0 && lines[first]?.trim() === 'BEGIN;') lines.splice(first, 1);
  let last = lines.length - 1;
  while (last >= 0 && lines[last]?.trim() === '') last--;
  if (last >= 0 && lines[last]?.trim() === 'COMMIT;') lines.splice(last, 1);
  return lines.join('\n').trimEnd() + '\n';
}

async function loadPgBoss() {
  return import('pg-boss');
}

export async function constructionSql(): Promise<string> {
  const { getConstructionPlans } = await loadPgBoss();
  return stripOuterTransaction(getConstructionPlans(PGBOSS_SCHEMA, { createSchema: true }));
}

export async function migrationSql(fromVersion: number): Promise<string> {
  const { getMigrationPlans } = await loadPgBoss();
  return stripOuterTransaction(getMigrationPlans(PGBOSS_SCHEMA, fromVersion));
}

const USAGE = 'Cách dùng: pnpm queue:sql --construct | --migrate-from <phiên bản schema cũ>';

async function main(argv: string[]): Promise<number> {
  if (argv.length === 1 && argv[0] === '--construct') {
    process.stdout.write(await constructionSql());
    return 0;
  }
  if (argv.length === 2 && argv[0] === '--migrate-from' && /^\d+$/.test(argv[1] ?? '')) {
    process.stdout.write(await migrationSql(Number(argv[1])));
    return 0;
  }
  console.error(USAGE);
  return 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(`Lỗi: ${err instanceof Error ? err.message : 'không xác định'}`);
      process.exit(1);
    },
  );
}
