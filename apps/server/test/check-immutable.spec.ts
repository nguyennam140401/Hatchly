import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkImmutable } from '../src/db/check-immutable';

// 008 (FR-019, R11): migration đã có ở nhánh gốc là bất biến; nhật ký chỉ được nối thêm.
// Mỗi ca dựng một kho git tạm: nhánh `base` có hai migration, nhánh làm việc sửa gì đó.

const FOLDER = 'apps/server/drizzle/migrations';
const entry = (idx: number, tag: string) => ({
  idx,
  version: '7',
  when: 1_000 + idx,
  tag,
  breakpoints: true,
});
const journal = (entries: unknown[]) =>
  `${JSON.stringify({ version: '7', dialect: 'postgresql', entries }, null, 2)}\n`;

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'immutable-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (file: string, content: string) => {
    writeFileSync(join(root, FOLDER, file), content);
  };
  const read = (file: string) => readFileSync(join(root, FOLDER, file), 'utf8');
  const commit = (message: string) => {
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', message);
  };
  git('init', '-q', '-b', 'base');
  git('config', 'core.autocrlf', 'false');
  mkdirSync(join(root, FOLDER, 'meta'), { recursive: true });
  write('0000_first.sql', 'CREATE TABLE a (id uuid);\n');
  write('0001_second.sql', 'CREATE TABLE b (id uuid);\n');
  write('meta/_journal.json', journal([entry(0, '0000_first'), entry(1, '0001_second')]));
  commit('base');
  git('checkout', '-q', '-b', 'work');
  return { root, git, write, read, commit };
}

const check = (root: string, base = 'base') => checkImmutable(root, base, FOLDER);

describe('db:immutable', () => {
  it('chỉ thêm tệp mới + nối nhật ký → đạt', () => {
    const r = repo();
    r.write('0002_third.sql', 'CREATE TABLE c (id uuid);\n');
    r.write(
      'meta/_journal.json',
      journal([entry(0, '0000_first'), entry(1, '0001_second'), entry(2, '0002_third')]),
    );
    r.commit('thêm migration');
    expect(check(r.root)).toEqual({ status: 'ok', checked: 3 });
  });

  it('không đổi gì → đạt', () => {
    expect(check(repo().root)).toEqual({ status: 'ok', checked: 3 });
  });

  it('sửa nội dung tệp cũ (kể cả chưa commit) → không đạt, nêu tệp', () => {
    const r = repo();
    r.write('0000_first.sql', 'CREATE TABLE a (id uuid, note text);\n');
    const uncommitted = check(r.root);
    expect(uncommitted).toMatchObject({
      status: 'failed',
      violations: [{ file: `${FOLDER}/0000_first.sql` }],
    });
    r.commit('sửa tệp cũ');
    const committed = check(r.root);
    expect(committed.status).toBe('failed');
    if (committed.status === 'failed') {
      expect(committed.violations[0]!.problem).toContain('bị sửa nội dung');
    }
  });

  it('xóa tệp cũ → không đạt', () => {
    const r = repo();
    rmSync(join(r.root, FOLDER, '0001_second.sql'));
    r.commit('xóa tệp cũ');
    const result = check(r.root);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.violations[0]!.file).toBe(`${FOLDER}/0001_second.sql`);
      expect(result.violations[0]!.problem).toContain('xóa');
    }
  });

  it('đổi tên tệp cũ → không đạt (tệp cũ biến mất)', () => {
    const r = repo();
    renameSync(
      join(r.root, FOLDER, '0001_second.sql'),
      join(r.root, FOLDER, '0001_second_renamed.sql'),
    );
    r.commit('đổi tên');
    const result = check(r.root);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.violations.map((v) => v.file)).toEqual([`${FOLDER}/0001_second.sql`]);
    }
  });

  it('chèn mục vào giữa nhật ký → không đạt', () => {
    const r = repo();
    r.write('0002_third.sql', 'CREATE TABLE c (id uuid);\n');
    r.write(
      'meta/_journal.json',
      journal([entry(0, '0000_first'), entry(2, '0002_third'), entry(1, '0001_second')]),
    );
    r.commit('chèn giữa');
    const result = check(r.root);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.file).toBe(`${FOLDER}/meta/_journal.json`);
      expect(result.violations[0]!.problem).toContain('0001_second');
    }
  });

  it('sửa mốc thời gian của mục cũ trong nhật ký → không đạt', () => {
    const r = repo();
    r.write(
      'meta/_journal.json',
      journal([entry(0, '0000_first'), { ...entry(1, '0001_second'), when: 5 }]),
    );
    r.commit('sửa when');
    expect(check(r.root).status).toBe('failed');
  });

  it('nhánh gốc đã đi tiếp (có migration mới mà nhánh làm việc chưa có) → vẫn đạt', () => {
    const r = repo();
    r.git('checkout', '-q', 'base');
    r.write('0002_from_base.sql', 'CREATE TABLE z (id uuid);\n');
    r.commit('base đi tiếp');
    r.git('checkout', '-q', 'work');
    expect(check(r.root)).toEqual({ status: 'ok', checked: 3 });
  });

  // T021: bộ chạy migration bỏ qua âm thầm mục có mốc cũ hơn migration mới nhất đã áp.
  it('migration mới có mốc when không lớn hơn migration đã có ở nhánh gốc → không đạt', () => {
    const r = repo();
    r.write('0002_third.sql', 'CREATE TABLE c (id uuid);\n');
    r.write(
      'meta/_journal.json',
      journal([
        entry(0, '0000_first'),
        entry(1, '0001_second'),
        { ...entry(2, '0002_third'), when: 1_001 },
      ]),
    );
    r.commit('mốc trùng');
    const result = check(r.root);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.problem).toContain('bỏ qua âm thầm');
      expect(result.violations[0]!.problem).toContain('0002_third');
    }
  });

  it('nhánh gốc đi tiếp với migration mới hơn; nhánh làm việc hợp nhất nhưng giữ mốc cũ → không đạt', () => {
    const r = repo();
    // Nhánh làm việc sinh migration TRƯỚC (when 1500)…
    r.write('0002_mine.sql', 'CREATE TABLE mine (id uuid);\n');
    r.write(
      'meta/_journal.json',
      journal([
        entry(0, '0000_first'),
        entry(1, '0001_second'),
        { ...entry(2, '0002_mine'), when: 1_500 },
      ]),
    );
    r.commit('migration của tôi');
    // …nhánh gốc nhận migration khác SAU đó (when 2000) và đã triển khai.
    r.git('checkout', '-q', 'base');
    r.write('0002_theirs.sql', 'CREATE TABLE theirs (id uuid);\n');
    r.write(
      'meta/_journal.json',
      journal([
        entry(0, '0000_first'),
        entry(1, '0001_second'),
        { ...entry(2, '0002_theirs'), when: 2_000 },
      ]),
    );
    r.commit('migration của người khác');
    r.git('checkout', '-q', 'work');
    // Hợp nhất: nhật ký giữ mục của nhánh gốc rồi nối mục của mình – nhưng chưa sửa mốc.
    const merged = (when: number) =>
      journal([
        entry(0, '0000_first'),
        entry(1, '0001_second'),
        { ...entry(2, '0002_theirs'), when: 2_000 },
        { ...entry(3, '0002_mine'), when },
      ]);
    try {
      r.git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'merge', '-q', 'base');
    } catch {
      // xung đột ở _journal.json là điều mong đợi – giải quyết bằng nội dung bên dưới
    }
    r.write('meta/_journal.json', merged(1_500));
    r.commit('hợp nhất nhánh gốc');
    const stale = check(r.root);
    expect(stale.status).toBe('failed');
    if (stale.status === 'failed') {
      expect(stale.violations[0]!.problem).toContain('0002_mine');
      expect(stale.violations[0]!.problem).toContain('0002_theirs');
    }
    // Đặt lại mốc của mục MỚI (chưa áp ở đâu) → đạt.
    r.write('meta/_journal.json', merged(2_500));
    r.commit('đặt lại mốc');
    expect(check(r.root).status).toBe('ok');
  });

  it('không có nhánh gốc (kho mới) → không áp dụng, kèm lý do', () => {
    const result = check(repo().root, 'origin/dev');
    expect(result).toEqual({
      status: 'not_applicable',
      note: 'không có nhánh gốc origin/dev (kho mới)',
    });
  });
});
