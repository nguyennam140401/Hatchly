import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// US4: verify chạy ĐỦ mọi bước (không dừng ở lỗi đầu), in bảng tổng kết, mã thoát 1 nếu có bước lỗi.
const verifyScript = join(dirname(fileURLToPath(import.meta.url)), '..', 'verify.mjs');

interface Step {
  name: string;
  command: string;
  requiresEnv?: string;
  skipReason?: string;
}
interface GateResult {
  schema: number;
  commit: string;
  mode: 'local' | 'ci';
  passed: boolean;
  results: {
    name: string;
    status: string;
    seconds: number;
    firstError: string;
    rerun: string;
    note: string;
    exception: unknown;
  }[];
}

function runWithSteps(steps: Step[], args: string[] = [], extraEnv: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-'));
  const file = join(dir, 'steps.json');
  const reportFile = join(dir, 'report.json');
  writeFileSync(file, JSON.stringify(steps));
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  delete env.VERIFY_TEST_UNSET;
  // Bộ kiểm thử có thể đang chạy trong CI – mỗi ca tự quyết định chế độ.
  if (!('CI' in extraEnv)) delete env.CI;
  const withReport = args.includes('--report');
  const finalArgs = withReport ? args.map((a) => (a === 'REPORT' ? reportFile : a)) : args;
  const result = spawnSync(process.execPath, [verifyScript, '--steps', file, ...finalArgs], {
    encoding: 'utf8',
    env,
  });
  // Bảng tổng kết in ra stdout; stderr của từng bước được chuyển tiếp riêng.
  return {
    code: result.status,
    out: result.stdout,
    err: result.stderr,
    report: () => JSON.parse(readFileSync(reportFile, 'utf8')) as GateResult,
  };
}

const ok = (name: string) => ({ name, command: 'node -e "console.log(1)"' });
const fail = (name: string, message: string) => ({
  name,
  command: `node -e "console.log('dong dau'); console.error('${message}'); process.exit(2)"`,
});
const needsEnv = (name: string): Step => ({
  name,
  command: 'node -e "process.exit(3)"',
  requiresEnv: 'VERIFY_TEST_UNSET',
  skipReason: 'chưa có CSDL kiểm thử',
});
const selfSkip = (name: string): Step => ({
  name,
  command: `node -e "console.log('SKIPPED: khong co du lieu')"`,
});
const notApplicable = (name: string): Step => ({
  name,
  command: `node -e "console.log('NOT_APPLICABLE: khong co migration moi')"`,
});
const lastLine = (out: string) => out.trimEnd().split('\n').at(-1);
const tableOf = (out: string) => out.slice(out.lastIndexOf('Bước'));

describe('tooling/verify.mjs', () => {
  it('một bước đạt, hai bước lỗi → chạy đủ 3 bước, mã thoát 1', () => {
    const { code, out } = runWithSteps([
      fail('buoc-loi-1', 'error TS2322: sai kieu'),
      ok('buoc-dat'),
      fail('buoc-loi-2', 'error vi pham ranh gioi'),
    ]);
    expect(code).toBe(1);
    const table = tableOf(out);
    const rows = table.split('\n').filter((l) => l.startsWith('buoc-'));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/✗ lỗi/);
    expect(rows[0]).toContain('error TS2322: sai kieu');
    expect(rows[1]).toMatch(/✓ đạt/);
    expect(rows[2]).toMatch(/✗ lỗi/);
    expect(lastLine(table)).toBe('→ THẤT BẠI: 2/3 bước lỗi');
  });

  it('mọi bước đạt → mã thoát 0', () => {
    const { code, out } = runWithSteps([ok('a'), ok('b')]);
    expect(code).toBe(0);
    expect(lastLine(out)).toBe('→ ĐẠT: 2/2 bước');
  });

  it('bước bỏ qua (requiresEnv chưa đặt, hoặc in SKIPPED:) → "– bỏ qua", không tính đạt/lỗi', () => {
    const { code, out } = runWithSteps([ok('a'), needsEnv('test:db'), selfSkip('tu-bo-qua')]);
    expect(code).toBe(0);
    const table = tableOf(out);
    expect(table).toMatch(/test:db\s+– bỏ qua.*\(chưa có CSDL kiểm thử\)/);
    expect(table).toMatch(/tu-bo-qua\s+– bỏ qua.*\(khong co du lieu\)/);
    expect(lastLine(table)).toBe('→ ĐẠT: 1/1 bước (2 bỏ qua)');
  });

  // ---- 008: hợp đồng contracts/quality-gates.md mục 1 ----

  it('FR-010: mỗi bước không đạt in lệnh chạy lại đúng cổng đó', () => {
    const { out } = runWithSteps([fail('lint', 'error sai'), ok('test')]);
    const table = tableOf(out);
    expect(table).toContain('↳ chạy lại: pnpm verify --only lint');
    expect(table).not.toContain('pnpm verify --only test');
  });

  it('--only chạy đúng các bước nêu, giữ thứ tự gốc', () => {
    const { code, out } = runWithSteps([ok('a'), fail('b', 'error x'), ok('c')], ['--only', 'c,a']);
    expect(code).toBe(0);
    const rows = tableOf(out)
      .split('\n')
      .filter((l) => /^[abc]\s/.test(l))
      .map((l) => l[0]);
    expect(rows).toEqual(['a', 'c']);
  });

  it('--only với tên lạ → lỗi nêu danh sách bước hợp lệ, không chạy bước nào', () => {
    const { code, out, err } = runWithSteps([ok('a'), ok('b')], ['--only', 'a,khong-co']);
    expect(code).toBe(1);
    expect(err).toContain('Không có bước: khong-co');
    expect(err).toContain('Các bước hợp lệ: a, b');
    expect(out).not.toContain('▶');
  });

  it('FR-008: --ci biến bước bị bỏ qua thành KHÔNG ĐẠT (cả hai kiểu bỏ qua)', () => {
    const steps = [ok('a'), needsEnv('test:db'), selfSkip('tu-bo-qua')];
    const ci = runWithSteps(steps, ['--ci']);
    expect(ci.code).toBe(1);
    const table = tableOf(ci.out);
    expect(table).toMatch(/test:db\s+✗ bỏ qua/);
    expect(table).toMatch(/tu-bo-qua\s+✗ bỏ qua/);
    expect(table).toContain('↳ chạy lại: pnpm verify --only test:db');
    expect(lastLine(table)).toBe('→ THẤT BẠI: 2/3 bước lỗi');
  });

  it('CI=true tương đương --ci', () => {
    const { code } = runWithSteps([ok('a'), needsEnv('test:db')], [], { CI: 'true' });
    expect(code).toBe(1);
  });

  it('NOT_APPLICABLE: → "· không áp dụng", tính đạt ở cả hai chế độ', () => {
    const steps = [ok('a'), notApplicable('db:compat')];
    const local = runWithSteps(steps);
    expect(local.code).toBe(0);
    expect(tableOf(local.out)).toMatch(/db:compat\s+· không áp dụng.*\(khong co migration moi\)/);
    expect(lastLine(local.out)).toBe('→ ĐẠT: 1/1 bước (1 không áp dụng)');
    expect(runWithSteps(steps, ['--ci']).code).toBe(0);
  });

  it('--report ghi GateResult đúng lược đồ; passed theo quy tắc của từng chế độ', () => {
    const steps = [
      ok('a'),
      fail('lint', 'error sai kieu'),
      needsEnv('test:db'),
      notApplicable('db:compat'),
    ];
    const local = runWithSteps(steps, ['--report', 'REPORT']);
    const report = local.report();
    expect(report.schema).toBe(1);
    expect(report.mode).toBe('local');
    expect(report.commit).toMatch(/^([0-9a-f]{40}|unknown)$/);
    expect(report.passed).toBe(false);
    expect(report.results.map((r) => [r.name, r.status])).toEqual([
      ['a', 'passed'],
      ['lint', 'failed'],
      ['test:db', 'skipped'],
      ['db:compat', 'not_applicable'],
    ]);
    const lint = report.results[1]!;
    expect(Object.keys(lint).sort()).toEqual(
      ['exception', 'firstError', 'name', 'note', 'rerun', 'seconds', 'status'].sort(),
    );
    expect(lint.firstError).toContain('error sai kieu');
    expect(lint.rerun).toBe('pnpm verify --only lint');
    expect(lint.exception).toBeNull();
    expect(typeof lint.seconds).toBe('number');
    expect(report.results[3]!.note).toBe('khong co migration moi');
    expect(report.results[2]!.note).toBe('chưa có CSDL kiểm thử');
  });

  it('--report: bỏ qua không làm hỏng passed ở máy cá nhân, nhưng làm hỏng ở chế độ ci', () => {
    const steps = [ok('a'), needsEnv('test:db'), notApplicable('db:compat')];
    const local = runWithSteps(steps, ['--report', 'REPORT']);
    expect(local.code).toBe(0);
    expect(local.report().passed).toBe(true);
    const ci = runWithSteps(steps, ['--ci', '--report', 'REPORT']);
    expect(ci.code).toBe(1);
    expect(ci.report().mode).toBe('ci');
    expect(ci.report().passed).toBe(false);
  });
});
