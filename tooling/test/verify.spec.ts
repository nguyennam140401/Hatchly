import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// US4: verify chạy ĐỦ mọi bước (không dừng ở lỗi đầu), in bảng tổng kết, mã thoát 1 nếu có bước lỗi.
const verifyScript = join(dirname(fileURLToPath(import.meta.url)), '..', 'verify.mjs');

function runWithSteps(
  steps: { name: string; command: string; requiresEnv?: string; skipReason?: string }[],
) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-'));
  const file = join(dir, 'steps.json');
  writeFileSync(file, JSON.stringify(steps));
  const env = { ...process.env };
  delete env.VERIFY_TEST_UNSET;
  const result = spawnSync(process.execPath, [verifyScript, '--steps', file], {
    encoding: 'utf8',
    env,
  });
  // Bảng tổng kết in ra stdout; stderr của từng bước được chuyển tiếp riêng.
  return { code: result.status, out: result.stdout };
}

const ok = (name: string) => ({ name, command: 'node -e "console.log(1)"' });
const fail = (name: string, message: string) => ({
  name,
  command: `node -e "console.log('dong dau'); console.error('${message}'); process.exit(2)"`,
});

describe('tooling/verify.mjs – bước infra:check (007, FR-027)', () => {
  it('danh sách bước mặc định có infra:check chạy `pnpm infra check`', () => {
    const source = readFileSync(verifyScript, 'utf8');
    expect(source).toContain("name: 'infra:check', command: 'pnpm infra check'");
  });

  it('đầu ra `SKIPPED:` của infra:check được tính là bỏ qua, không phải lỗi', () => {
    const { code, out } = runWithSteps([
      ok('a'),
      {
        name: 'infra:check',
        command: `node -e "console.log('SKIPPED: chưa cài terraform – cài đủ công cụ')"`,
      },
    ]);
    expect(code).toBe(0);
    expect(out).toMatch(/infra:check\s+– bỏ qua.*\(chưa cài terraform/);
  });
});

describe('tooling/verify.mjs', () => {
  it('một bước đạt, hai bước lỗi → chạy đủ 3 bước, mã thoát 1', () => {
    const { code, out } = runWithSteps([
      fail('buoc-loi-1', 'error TS2322: sai kieu'),
      ok('buoc-dat'),
      fail('buoc-loi-2', 'error vi pham ranh gioi'),
    ]);
    expect(code).toBe(1);
    const table = out.slice(out.lastIndexOf('Bước'));
    const rows = table.split('\n').filter((l) => l.startsWith('buoc-'));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/✗ lỗi/);
    expect(rows[0]).toContain('error TS2322: sai kieu');
    expect(rows[1]).toMatch(/✓ đạt/);
    expect(rows[2]).toMatch(/✗ lỗi/);
    expect(table.trimEnd().split('\n').at(-1)).toBe('→ THẤT BẠI: 2/3 bước lỗi');
  });

  it('mọi bước đạt → mã thoát 0', () => {
    const { code, out } = runWithSteps([ok('a'), ok('b')]);
    expect(code).toBe(0);
    expect(out.trimEnd().split('\n').at(-1)).toBe('→ ĐẠT: 2/2 bước');
  });

  it('bước bỏ qua (requiresEnv chưa đặt, hoặc in SKIPPED:) → "– bỏ qua", không tính đạt/lỗi', () => {
    const { code, out } = runWithSteps([
      ok('a'),
      {
        name: 'test:db',
        command: 'node -e "process.exit(3)"',
        requiresEnv: 'VERIFY_TEST_UNSET',
        skipReason: 'chưa có CSDL kiểm thử',
      },
      { name: 'tu-bo-qua', command: `node -e "console.log('SKIPPED: khong co du lieu')"` },
    ]);
    expect(code).toBe(0);
    const table = out.slice(out.lastIndexOf('Bước'));
    expect(table).toMatch(/test:db\s+– bỏ qua.*\(chưa có CSDL kiểm thử\)/);
    expect(table).toMatch(/tu-bo-qua\s+– bỏ qua.*\(khong co du lieu\)/);
    expect(table.trimEnd().split('\n').at(-1)).toBe('→ ĐẠT: 1/1 bước (2 bỏ qua)');
  });
});
