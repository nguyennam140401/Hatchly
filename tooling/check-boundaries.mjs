// pnpm check:boundaries – chạy dependency-cruiser theo tệp kê khai module (FR-011) + quy tắc quét SQL
// truy cập schema của module khác (006 R16, `no-cross-schema-sql`).
// depcruise trả mã thoát bằng số vi phạm; hợp đồng lệnh (contracts/repo-commands.md) cần 0 / 1.
import { spawnSync } from 'node:child_process';
import { findCrossSchemaSql, formatCrossSchemaViolation } from './boundaries/cross-schema-sql.mjs';

const result = spawnSync(
  'depcruise',
  ['apps', 'packages', '--config', '.dependency-cruiser.cjs', '--output-type', 'err-long'],
  { stdio: 'inherit', shell: true },
);

const sqlViolations = findCrossSchemaSql(process.cwd());
if (sqlViolations.length > 0) {
  console.error(`\nTruy cập schema của module khác trong SQL (${sqlViolations.length}):`);
  for (const v of sqlViolations) console.error(formatCrossSchemaViolation(v));
} else {
  console.log('✔ no-cross-schema-sql: không module nào viết SQL vào schema của module khác');
}

process.exit(result.status === 0 && sqlViolations.length === 0 ? 0 : 1);
