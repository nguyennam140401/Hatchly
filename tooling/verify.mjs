// pnpm verify – chạy MỌI bước kiểm tra theo thứ tự, không dừng ở lỗi đầu, in bảng tổng kết (FR-018, R13).
// Dùng: node tooling/verify.mjs [--steps <tệp.json>]   (tệp: [{ "name": "...", "command": "..." }])
// Một bước có thể "bỏ qua" (không tính đạt/lỗi): khai báo `requiresEnv` mà biến chưa đặt, hoặc lệnh
// in một dòng bắt đầu bằng `SKIPPED:` và thoát mã 0 (002, FR-021).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

const DEFAULT_STEPS = [
  ...[
    'build:shared',
    'typecheck',
    'lint',
    'check:boundaries',
    'check:secrets',
    'test',
    'check:web-bundle',
    'db:lint-migrations',
  ].map((name) => ({ name, command: `pnpm ${name}` })),
  // Kiểm thử CSDL thật (gồm db:check trên CSDL tạm đã migrate – conventions.db.spec.ts).
  {
    name: 'test:db',
    command: 'pnpm test:db',
    requiresEnv: 'TEST_DATABASE_ADMIN_URL',
    skipReason: 'chưa có CSDL kiểm thử',
  },
  // Kiểm thử tích hợp hàng chờ trên PostgreSQL thật (003, FR-034).
  {
    name: 'test:queue',
    command: 'pnpm test:queue',
    requiresEnv: 'TEST_DATABASE_ADMIN_URL',
    skipReason: 'chưa có CSDL kiểm thử',
  },
  // Kiểm thử trình duyệt (006, nhóm g): Playwright + Chromium trên CSDL tạm, API/web cổng riêng.
  // Cài trình duyệt một lần: pnpm --filter @app/e2e exec playwright install chromium.
  {
    name: 'test:e2e',
    command: 'pnpm test:e2e',
    requiresEnv: 'TEST_DATABASE_ADMIN_URL',
    skipReason: 'chưa có CSDL kiểm thử',
  },
];

function readSteps(argv) {
  const index = argv.indexOf('--steps');
  if (index === -1) return DEFAULT_STEPS;
  const file = argv[index + 1];
  if (!file) throw new Error('Thiếu đường dẫn tệp sau --steps');
  return JSON.parse(readFileSync(file, 'utf8'));
}

// Bỏ mã màu ANSI để tìm dòng lỗi.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const ERROR_LINE = /(error|✖|✗|×|FAIL|failed|violation|\[warn\])/i;

/** Dòng lỗi đầu tiên đáng chú ý trong đầu ra của một bước. */
function firstErrorLine(output) {
  const lines = output
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('>'));
  const index = lines.findIndex((l) => ERROR_LINE.test(l));
  let line = index >= 0 ? lines[index] : (lines.at(-1) ?? '');
  // ESLint in tên tệp ở dòng riêng phía trên "dòng:cột  error …" – ghép lại để biết tệp nào lỗi.
  if (index > 0 && /^\d+:\d+\s/.test(line)) {
    const file = lines
      .slice(0, index)
      .reverse()
      .find((l) => /\.[cm]?[jt]sx?$/.test(l));
    if (file) line = `${relative(process.cwd(), file)}:${line}`;
  }
  return line.length > 110 ? `${line.slice(0, 107)}...` : line;
}

/** Chạy một bước, chuyển tiếp đầu ra ra màn hình và giữ lại để tìm dòng lỗi. */
function runStep(step) {
  if (step.requiresEnv && !process.env[step.requiresEnv]) {
    process.stdout.write(`bỏ qua: chưa đặt ${step.requiresEnv}\n`);
    return Promise.resolve({
      name: step.name,
      ok: true,
      skipped: true,
      seconds: 0,
      error: '',
      reason: step.skipReason ?? `chưa đặt ${step.requiresEnv}`,
    });
  }
  return new Promise((resolve) => {
    const started = performance.now();
    let output = '';
    // shell: true để chạy được `pnpm` (pnpm.cmd) trên Windows.
    const child = spawn(step.command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = (target) => (chunk) => {
      output += chunk.toString();
      target.write(chunk);
    };
    child.stdout.on('data', collect(process.stdout));
    child.stderr.on('data', collect(process.stderr));
    const finish = (code) => {
      const skipLine = output
        .replace(ANSI, '')
        .split(/\r?\n/)
        .find((l) => l.startsWith('SKIPPED:'));
      resolve({
        name: step.name,
        ok: code === 0,
        skipped: code === 0 && skipLine !== undefined,
        seconds: (performance.now() - started) / 1000,
        error: code === 0 ? '' : firstErrorLine(output),
        reason: skipLine?.slice('SKIPPED:'.length).trim() ?? '',
      });
    };
    child.on('error', (err) => {
      output += String(err);
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

const formatSeconds = (s) => `${s.toFixed(1).replace('.', ',')} s`;

function printSummary(results) {
  const width = Math.max(18, ...results.map((r) => r.name.length + 2));
  const lines = ['', `${'Bước'.padEnd(width)} Kết quả   Thời gian`];
  for (const r of results) {
    const status = r.skipped ? '– bỏ qua' : r.ok ? '✓ đạt' : '✗ lỗi';
    const extra = r.skipped ? `   (${r.reason})` : r.ok ? '' : `   (${r.error})`;
    lines.push(
      `${r.name.padEnd(width)} ${status.padEnd(9)} ${formatSeconds(r.seconds).padEnd(7)}${extra}`.trimEnd(),
    );
  }
  const failed = results.filter((r) => !r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;
  const counted = results.length - skipped;
  const skipNote = skipped > 0 ? ` (${skipped} bỏ qua)` : '';
  const total = results.reduce((sum, r) => sum + r.seconds, 0);
  lines.push(`Tổng thời gian: ${formatSeconds(total)}`);
  lines.push(
    failed > 0
      ? `→ THẤT BẠI: ${failed}/${counted} bước lỗi${skipNote}`
      : `→ ĐẠT: ${counted}/${counted} bước${skipNote}`,
  );
  process.stdout.write(`${lines.join('\n')}\n`);
  return failed;
}

const steps = readSteps(process.argv.slice(2));
const results = [];
for (const step of steps) {
  process.stdout.write(`\n▶ ${step.name}\n`);
  results.push(await runStep(step));
}
process.exit(printSummary(results) > 0 ? 1 : 0);
