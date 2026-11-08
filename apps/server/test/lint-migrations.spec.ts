import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintMigrationSql, splitStatements } from '../src/db/lint-migrations';

// FR-012, R17: phát hiện câu lệnh phá tương thích ngược trong migration mới.
const FIXTURES = join(__dirname, 'fixtures', 'migrations');
const lint = (name: string) => lintMigrationSql(readFileSync(join(FIXTURES, name), 'utf8'), name);

describe('db:lint-migrations', () => {
  it('tệp vi phạm → báo đủ 5 câu kèm dòng và lý do', () => {
    const v = lint('violating.sql');
    expect(v.map((x) => [x.line, x.reason])).toEqual([
      [2, 'xóa cột'],
      [4, 'đổi tên'],
      [6, 'SET NOT NULL trên cột có sẵn (cần backfill trước, phát hành riêng)'],
      [8, 'đổi kiểu cột'],
      [10, 'xóa bảng'],
    ]);
    expect(v[0]!.file).toBe('violating.sql');
  });

  it('có chú thích breaking-ok ngay dòng trên → không báo', () => {
    expect(lint('breaking-ok.sql')).toEqual([]);
  });

  it('tệp sạch (bảng mới, thân hàm có DROP/;) → không báo', () => {
    expect(lint('clean.sql')).toEqual([]);
  });

  it('migration hiện có của kho không vi phạm', () => {
    const dir = join(__dirname, '..', 'drizzle', 'migrations');
    for (const f of ['0000_schemas_grants.sql', '0003_audit_log.sql']) {
      expect(lintMigrationSql(readFileSync(join(dir, f), 'utf8'), f)).toEqual([]);
    }
  });

  it('tách câu bỏ qua ; trong chuỗi và $$', () => {
    const parts = splitStatements("SELECT ';'; DO $$ BEGIN PERFORM 1; END $$; SELECT 2");
    expect(parts.map((p) => p.text)).toEqual([
      "SELECT ';'",
      'DO $$ BEGIN PERFORM 1; END $$',
      'SELECT 2',
    ]);
  });
});
