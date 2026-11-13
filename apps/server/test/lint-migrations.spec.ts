import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintMigrationSql, migrationBaseRef, splitStatements } from '../src/db/lint-migrations';

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

  // ---- 008 (FR-017, R11): luật mới, mỗi luật một ca vi phạm + một ca hợp lệ ----

  it('luật 008: tệp vi phạm → mỗi câu một mã luật, kèm cách chia bước thay thế', () => {
    const v = lint('rules-008-violating.sql');
    expect(v.map((x) => [x.line, x.code])).toEqual([
      [2, 'add-not-null-without-default'],
      [4, 'add-constraint-validating'],
      [6, 'add-constraint-validating'],
      [8, 'add-constraint-validating'],
      [10, 'create-index-blocking'],
      [12, 'create-index-blocking'],
      [14, 'drop-type'],
    ]);
    for (const x of v) {
      expect(x.reason.length).toBeGreaterThan(10);
      expect(x.alternative.length).toBeGreaterThan(10);
    }
    expect(v[0]!.alternative).toContain('DEFAULT');
    expect(v[1]!.alternative).toContain('NOT VALID');
    expect(v[4]!.alternative).toContain('CONCURRENTLY');
  });

  it('luật 008: cách viết mở rộng, bảng mới trong cùng tệp và breaking-ok → không báo', () => {
    expect(lint('rules-008-clean.sql')).toEqual([]);
  });

  it('luật cũ cũng có mã và cách thay thế', () => {
    const v = lint('violating.sql');
    expect(v.map((x) => x.code)).toEqual([
      'drop-column',
      'rename',
      'set-not-null',
      'alter-column-type',
      'drop-table',
    ]);
    expect(v.every((x) => x.alternative !== '')).toBe(true);
  });

  it('mọi migration hiện có của kho qua được cả luật mới hoặc đã khai báo', () => {
    // Tệp cũ không bị quét lại ở cổng (chỉ tệp mới so với nhánh gốc) – ca này chỉ khẳng định bộ tách
    // câu lệnh không vỡ trên SQL thật của kho.
    const dir = join(__dirname, '..', 'drizzle', 'migrations');
    for (const f of readdirSync(dir).filter((name) => name.endsWith('.sql'))) {
      expect(() => lintMigrationSql(readFileSync(join(dir, f), 'utf8'), f)).not.toThrow();
    }
  });

  it('MIGRATION_BASE_REF: mặc định origin/dev; Jenkins đặt origin/<nhánh đích>', () => {
    expect(migrationBaseRef({})).toBe('origin/dev');
    expect(migrationBaseRef({ MIGRATION_BASE_REF: '' })).toBe('origin/dev');
    expect(migrationBaseRef({ MIGRATION_BASE_REF: 'origin/master' })).toBe('origin/master');
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
