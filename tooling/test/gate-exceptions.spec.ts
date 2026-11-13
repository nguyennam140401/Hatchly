import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadExceptions } from '../lib/gate-exceptions.mjs';

// 008 (FR-009, R17): ngoại lệ vượt cổng – chỉ cổng cho phép, có người duyệt đúng vai, tối đa 7 ngày.

const verifyScript = join(dirname(fileURLToPath(import.meta.url)), '..', 'verify.mjs');

interface Loaded {
  file: string;
  data: Record<string, unknown> | null;
  errors: string[];
  expired: boolean;
}
const load = loadExceptions as (options: {
  dir: string;
  teamFile: string;
  gateNames: string[];
  now?: Date;
}) => Loaded[];

const NOW = new Date('2026-11-14T08:00:00Z');
const GATES = ['lint', 'test', 'test:db', 'check:secrets'];
const VALID = {
  gate: 'lint',
  reason: 'Luật lint mới bắt nhầm tệp sinh tự động, sửa cấu hình ở PR sau',
  approvedBy: 'sa-user',
  expiresAt: '2026-11-18T00:00:00Z',
  pullRequest: 42,
};

/** Thư mục tạm có ops/ci/team.json và một tệp ngoại lệ. */
function workspace(fileName: string, fields: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'gate-exc-'));
  const dir = join(root, 'ops', 'ci', 'exceptions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(root, 'ops', 'ci', 'team.json'),
    JSON.stringify({
      members: [
        { github: 'sa-user', telegram: '', roles: ['developer', 'release-manager'] },
        { github: 'dev-user', telegram: '', roles: ['developer'] },
      ],
      onCall: [],
    }),
  );
  const yaml = Object.entries(fields)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
    .join('\n');
  writeFileSync(join(dir, fileName), `${yaml}\n`);
  return root;
}
function check(fields: Record<string, unknown>, fileName = '2026-11-13-lint.yml') {
  const root = workspace(fileName, fields);
  const [item] = load({
    dir: join(root, 'ops', 'ci', 'exceptions'),
    teamFile: join(root, 'ops', 'ci', 'team.json'),
    gateNames: GATES,
    now: NOW,
  });
  return item!;
}
const without = (key: string) => {
  const copy: Record<string, unknown> = { ...VALID };
  Reflect.deleteProperty(copy, key);
  return copy;
};

describe('tooling/lib/gate-exceptions.mjs', () => {
  it('ngoại lệ hợp lệ, còn hạn', () => {
    const item = check(VALID);
    expect(item.errors).toEqual([]);
    expect(item.expired).toBe(false);
  });

  it('phạm vi bằng commit thay cho pullRequest cũng hợp lệ', () => {
    expect(check({ ...without('pullRequest'), commit: 'abc1234' }).errors).toEqual([]);
  });

  it.each(['test:db', 'check:secrets'])('gate: %s → không bao giờ được vượt', (gate) => {
    expect(check({ ...VALID, gate }).errors.join()).toContain('không bao giờ được vượt');
  });

  it('gate không phải tên bước → không hợp lệ', () => {
    expect(check({ ...VALID, gate: 'khong-co' }).errors.join()).toContain(
      'không phải tên một bước',
    );
  });

  it('expiresAt trong quá khứ → hợp lệ nhưng hết hạn (bị bỏ qua)', () => {
    const item = check({ ...VALID, expiresAt: '2026-11-14T07:00:00Z' });
    expect(item.errors).toEqual([]);
    expect(item.expired).toBe(true);
  });

  it('expiresAt quá 7 ngày kể từ ngày trong tên tệp → không hợp lệ', () => {
    expect(check({ ...VALID, expiresAt: '2026-11-21T00:00:00Z' }).errors.join()).toContain(
      'quá 7 ngày',
    );
    // Hết ngày thứ 7 vẫn hợp lệ.
    expect(check({ ...VALID, expiresAt: '2026-11-20T23:59:00Z' }).errors).toEqual([]);
  });

  it('expiresAt không phải ISO-8601 UTC → không hợp lệ', () => {
    expect(check({ ...VALID, expiresAt: '2026-11-18 10:00' }).errors.join()).toContain('ISO-8601');
    expect(check({ ...VALID, expiresAt: '2026-11-18T10:00:00+07:00' }).errors.join()).toContain(
      'ISO-8601',
    );
  });

  it('reason dưới 20 ký tự → không hợp lệ', () => {
    expect(check({ ...VALID, reason: 'tạm thời' }).errors.join()).toContain('reason');
  });

  it('approvedBy không có vai release-manager → không hợp lệ', () => {
    expect(check({ ...VALID, approvedBy: 'dev-user' }).errors.join()).toContain('release-manager');
    expect(check({ ...VALID, approvedBy: 'nguoi-la' }).errors.join()).toContain('release-manager');
  });

  it('thiếu cả pullRequest lẫn commit → không hợp lệ', () => {
    expect(check(without('pullRequest')).errors.join()).toContain('phạm vi');
  });

  it('tên tệp sai dạng → không hợp lệ', () => {
    expect(check(VALID, 'lint.yml').errors.join()).toContain('tên tệp');
  });
});

describe('pnpm verify --ci áp ngoại lệ', () => {
  const failing = {
    name: 'lint',
    command: `node -e "console.error('error sai'); process.exit(1)"`,
  };
  const dbFailing = { ...failing, name: 'test:db' };
  const passing = { name: 'test', command: 'node -e "console.log(1)"' };

  interface Report {
    passed: boolean;
    results: {
      name: string;
      status: string;
      exception: { file: string; approvedBy: string } | null;
    }[];
  }
  /** Chạy verify trong thư mục tạm (ngoại lệ được đọc theo thư mục hiện tại). */
  function verify(root: string, steps: unknown[], args: string[]) {
    const stepsFile = join(root, 'steps.json');
    const reportFile = join(root, 'report.json');
    writeFileSync(stepsFile, JSON.stringify(steps));
    const env = { ...process.env };
    delete env.CI;
    const result = spawnSync(
      process.execPath,
      [verifyScript, '--steps', stepsFile, '--report', reportFile, ...args],
      { encoding: 'utf8', cwd: root, env },
    );
    return {
      code: result.status,
      out: result.stdout,
      report: JSON.parse(readFileSync(reportFile, 'utf8')) as Report,
    };
  }
  // Ngoại lệ dùng thời gian thật: tên tệp là hôm nay, hết hạn sau 2 ngày.
  const today = new Date().toISOString().slice(0, 10);
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  const active = { ...VALID, expiresAt: inDays(2) };

  it('cổng đỏ có ngoại lệ còn hạn → excepted, lần chạy đạt, báo cáo ghi tệp + người duyệt', () => {
    const root = workspace(`${today}-lint.yml`, active);
    const { code, out, report } = verify(root, [failing, passing], ['--ci']);
    expect(code).toBe(0);
    expect(report.passed).toBe(true);
    expect(report.results[0]).toMatchObject({
      name: 'lint',
      status: 'excepted',
      exception: { file: `ops/ci/exceptions/${today}-lint.yml`, approvedBy: 'sa-user' },
    });
    expect(out).toMatch(/lint\s+! ngoại lệ/);
    expect(out.trimEnd().split('\n').at(-1)).toBe('→ ĐẠT: 2/2 bước (1 ngoại lệ)');
  });

  it('máy cá nhân (không --ci) không áp ngoại lệ', () => {
    const root = workspace(`${today}-lint.yml`, active);
    const { code, report } = verify(root, [failing, passing], []);
    expect(code).toBe(1);
    expect(report.results[0]!.status).toBe('failed');
  });

  it('ngoại lệ hết hạn → bị bỏ qua, cổng vẫn đỏ', () => {
    const root = workspace(`${today}-lint.yml`, { ...VALID, expiresAt: inDays(-1) });
    expect(verify(root, [failing], ['--ci']).code).toBe(1);
  });

  it('ngoại lệ cho cổng cấm (test:db) → không có tác dụng', () => {
    const root = workspace(`${today}-db.yml`, { ...active, gate: 'test:db' });
    const { code, report } = verify(root, [dbFailing], ['--ci']);
    expect(code).toBe(1);
    expect(report.results[0]!.status).toBe('failed');
  });

  it('ngoại lệ của cổng khác không cứu cổng đang đỏ', () => {
    const root = workspace(`${today}-test.yml`, { ...active, gate: 'test' });
    expect(verify(root, [failing, passing], ['--ci']).code).toBe(1);
  });
});
