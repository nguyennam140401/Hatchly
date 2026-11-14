import { describe, expect, it } from 'vitest';
import { dbCompat } from '../db-compat.mjs';

// 008 (FR-018): ba nhánh NOT_APPLICABLE của db:compat và việc dọn dẹp khi lỗi – bằng trình chạy lệnh giả.

interface Result {
  status: 'not_applicable' | 'ok' | 'failed';
  note: string;
}
interface Call {
  command: string;
  args: string[];
}
interface Reply {
  status: number;
  stdout?: string;
  stderr?: string;
}
const check = dbCompat as (o: {
  env?: Record<string, string | undefined>;
  run: (command: string, args: string[], options?: unknown) => Reply;
  root?: string;
  log?: (s: string) => void;
}) => Result;

const SHA = 'a'.repeat(40);
const NEW_MIGRATION = 'apps/server/drizzle/migrations/0014_new.sql\n';
const PKG_WITH = JSON.stringify({ scripts: { 'test:compat': 'x' } });
const DB_JSON = `${JSON.stringify({ name: 'app_compat_ab12', owner: 'o', app: 'a', system: 's', support: 'p' })}\n`;

/** Trình chạy giả: `overrides` khớp theo chuỗi lệnh ghép; mặc định thành công rỗng. */
function fake(overrides: Record<string, Reply> = {}) {
  const calls: Call[] = [];
  const run = (command: string, args: string[]): Reply => {
    calls.push({ command, args });
    const key = `${command} ${args.join(' ')}`;
    for (const [pattern, reply] of Object.entries(overrides)) {
      if (key.includes(pattern)) return reply;
    }
    return { status: 0, stdout: '' };
  };
  return {
    run,
    calls,
    has: (text: string) => calls.some((c) => `${c.command} ${c.args.join(' ')}`.includes(text)),
  };
}
const baseOverrides = (extra: Record<string, Reply> = {}): Record<string, Reply> => ({
  'rev-parse --verify': { status: 0, stdout: `${SHA}\n` },
  'diff --name-only': { status: 0, stdout: NEW_MIGRATION },
  'show ': { status: 0, stdout: PKG_WITH },
  'prepare-compat-db.ts create': { status: 0, stdout: DB_JSON },
  ...extra,
});

describe('tooling/db-compat.mjs', () => {
  it('COMPAT_BASE_SHA=none → chưa có bản đang chạy, không đụng tới git/CSDL', () => {
    const f = fake();
    const r = check({ env: { COMPAT_BASE_SHA: 'none' }, run: f.run, log: () => undefined });
    expect(r).toEqual({ status: 'not_applicable', note: 'chưa có bản đang chạy' });
    expect(f.calls).toEqual([]);
  });

  it('không thấy nhánh gốc (môi trường chưa từng triển khai) → chưa có bản đang chạy', () => {
    const f = fake({ 'rev-parse --verify': { status: 1 } });
    const r = check({ env: {}, run: f.run, log: () => undefined });
    expect(r.status).toBe('not_applicable');
    expect(r.note).toContain('chưa có bản đang chạy');
    expect(r.note).toContain('origin/dev');
  });

  it('không có migration mới so với bản gốc → không áp dụng', () => {
    const f = fake(
      baseOverrides({
        'diff --name-only': {
          status: 0,
          stdout: 'apps/server/drizzle/migrations/meta/_journal.json\n',
        },
      }),
    );
    const r = check({ env: { GATE_TARGET_BRANCH: 'master' }, run: f.run, log: () => undefined });
    expect(r).toEqual({ status: 'not_applicable', note: 'không có migration mới' });
    expect(f.has('origin/master')).toBe(true);
    expect(f.has('worktree add')).toBe(false);
  });

  it('bản gốc chưa có kịch bản test:compat (bản trước 008) → không áp dụng, kèm lý do', () => {
    const f = fake(
      baseOverrides({ 'show ': { status: 0, stdout: JSON.stringify({ scripts: {} }) } }),
    );
    const r = check({ env: {}, run: f.run, log: () => undefined });
    expect(r.status).toBe('not_applicable');
    expect(r.note).toContain('chưa có kịch bản test:compat');
    expect(f.has('worktree add')).toBe(false);
  });

  it('bản gốc chạy được → ok; có dựng worktree + CSDL và dọn cả hai', () => {
    const f = fake(baseOverrides());
    const r = check({ env: { COMPAT_BASE_SHA: SHA }, run: f.run, log: () => undefined });
    expect(r.status).toBe('ok');
    expect(f.has('worktree add --detach .compat-base')).toBe(true);
    expect(f.has('test:compat')).toBe(true);
    expect(f.has('prepare-compat-db.ts drop app_compat_ab12')).toBe(true);
    expect(f.has('worktree remove --force .compat-base')).toBe(true);
  });

  it('bản gốc không chạy được trên cấu trúc mới → failed, nêu bản gốc + migration + dòng lỗi đầu; vẫn dọn', () => {
    const f = fake(
      baseOverrides({
        'test:compat': {
          status: 1,
          stdout: 'chay...\nerror: column "legacy_name" does not exist\n',
        },
      }),
    );
    const r = check({ env: {}, run: f.run, log: () => undefined });
    expect(r.status).toBe('failed');
    expect(r.note).toContain(SHA.slice(0, 12));
    expect(r.note).toContain('0014_new.sql');
    expect(r.note).toContain('column "legacy_name" does not exist');
    expect(f.has('prepare-compat-db.ts drop app_compat_ab12')).toBe(true);
    expect(f.has('worktree remove --force .compat-base')).toBe(true);
  });

  it('dựng CSDL tạm lỗi → failed và vẫn gỡ worktree', () => {
    const f = fake(
      baseOverrides({
        'prepare-compat-db.ts create': { status: 1, stderr: 'Lỗi: kết nối bị từ chối' },
      }),
    );
    const r = check({ env: {}, run: f.run, log: () => undefined });
    expect(r.status).toBe('failed');
    expect(r.note).toContain('CSDL tạm');
    expect(f.has('worktree remove --force .compat-base')).toBe(true);
    expect(f.has('prepare-compat-db.ts drop')).toBe(false);
  });
});
