// pnpm verify – nguồn sự thật DUY NHẤT của các cổng chất lượng (008, R9; contracts/quality-gates.md).
// Chạy MỌI bước theo thứ tự, không dừng ở lỗi đầu, in bảng tổng kết.
//
//   pnpm verify                         máy cá nhân: bước thiếu điều kiện được "bỏ qua" (không tính)
//   pnpm verify --only <bước>[,<bước>]  chạy đúng các bước nêu (lệnh "chạy lại cổng này")
//   pnpm verify --ci                    bỏ qua = KHÔNG ĐẠT (FR-008); áp ngoại lệ còn hạn; CI=true tương đương
//   pnpm verify --report <tệp.json>     ghi GateResult (data-model.md mục 1)
//   pnpm verify --steps <tệp.json>      thay danh sách bước (kiểm thử): [{ "name", "command", "requiresEnv"? }]
//
// Một bước tự báo trạng thái bằng một dòng ở đầu ra (và thoát mã 0):
//   SKIPPED: <lý do>         thiếu điều kiện chạy (Docker, CSDL…) – máy cá nhân bỏ qua, --ci là không đạt
//   NOT_APPLICABLE: <lý do>  cổng không áp dụng cho thay đổi này (vd không có migration mới) – luôn tính đạt
// Thêm cổng = thêm một mục vào DEFAULT_STEPS + một dòng ở bảng hợp đồng + gán làn trong ops/ci/gate-lanes.json.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findActiveException, loadExceptions } from './lib/gate-exceptions.mjs';

const NEEDS_DB = { requiresEnv: 'TEST_DATABASE_ADMIN_URL', skipReason: 'chưa có CSDL kiểm thử' };
const simple = (name) => ({ name, command: `pnpm ${name}` });

export const DEFAULT_STEPS = [
  simple('build:shared'),
  simple('typecheck'),
  simple('lint'),
  simple('check:boundaries'),
  simple('check:secrets'),
  // 008 (R19): phiên bản cố định, lược đồ tham số môi trường, làn, ngoại lệ hợp lệ, helm lint.
  simple('check:pipeline'),
  // 008 (R8): master chỉ nhận từ dev đã triển khai test thành công, hoặc từ hotfix/*.
  simple('check:release-source'),
  simple('test'),
  simple('check:web-bundle'),
  simple('db:lint-migrations'),
  // 008 (FR-019): migration đã có ở nhánh gốc không được sửa/xóa; nhật ký chỉ nối thêm.
  simple('db:immutable'),
  // Kiểm thử CSDL thật (gồm db:check trên CSDL tạm đã migrate – conventions.db.spec.ts).
  { ...simple('test:db'), ...NEEDS_DB },
  // Kiểm thử tích hợp hàng chờ trên PostgreSQL thật (003, FR-034).
  { ...simple('test:queue'), ...NEEDS_DB },
  // 008 (FR-018): bản đang chạy vẫn chạy được trên cấu trúc CSDL của bản mới.
  { ...simple('db:compat'), ...NEEDS_DB },
  // 005 (SC-009): nhật ký mẫu của các bước kiểm thử (apps/server/test-logs/*.ndjson) không được chứa
  // mã quyền giả, lời nhắc, nội dung bài hay bí mật – chạy SAU mọi bước kiểm thử.
  {
    name: 'check:secrets:test-logs',
    command: 'node tooling/scan-secrets.mjs apps/server/test-logs',
  },
  // Kiểm thử trình duyệt (006, nhóm g): Playwright + Chromium trên CSDL tạm, API/web cổng riêng.
  // Cài trình duyệt một lần: pnpm --filter @app/e2e exec playwright install chromium.
  { ...simple('test:e2e'), ...NEEDS_DB },
  // 008 (FR-022…024): dựng ảnh phát hành, kiểm nội dung, chạy ba vai migrate → api → worker.
  { ...simple('check:image'), ...NEEDS_DB },
];

/** Giá trị đứng sau một cờ; thiếu → lỗi. */
function optionValue(argv, flag, what) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Thiếu ${what} sau ${flag}`);
  return value;
}

export function parseArgs(argv, env = process.env) {
  const stepsFile = optionValue(argv, '--steps', 'đường dẫn tệp');
  const only = optionValue(argv, '--only', 'tên bước');
  return {
    stepsFile,
    only: only
      ? only
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '')
      : undefined,
    report: optionValue(argv, '--report', 'đường dẫn tệp'),
    ci: argv.includes('--ci') || env.CI === 'true',
  };
}

function selectSteps(options) {
  const all = options.stepsFile
    ? JSON.parse(readFileSync(options.stepsFile, 'utf8'))
    : DEFAULT_STEPS;
  if (!options.only) return all;
  const names = all.map((s) => s.name);
  const unknown = options.only.filter((n) => !names.includes(n));
  if (unknown.length > 0) {
    throw new Error(`Không có bước: ${unknown.join(', ')}. Các bước hợp lệ: ${names.join(', ')}`);
  }
  return all.filter((s) => options.only.includes(s.name));
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

/** Dòng đánh dấu (`SKIPPED:` / `NOT_APPLICABLE:`) trong đầu ra → lý do, hoặc undefined. */
function markerReason(output, marker) {
  const line = output
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith(marker));
  return line === undefined ? undefined : line.slice(marker.length).trim();
}

const blank = (step) => ({
  name: step.name,
  status: 'passed',
  seconds: 0,
  firstError: '',
  rerun: `pnpm verify --only ${step.name}`,
  note: '',
  exception: null,
});

/** Chạy một bước, chuyển tiếp đầu ra ra màn hình và giữ lại để tìm dòng lỗi. */
function runStep(step) {
  if (step.requiresEnv && !process.env[step.requiresEnv]) {
    process.stdout.write(`bỏ qua: chưa đặt ${step.requiresEnv}\n`);
    return Promise.resolve({
      ...blank(step),
      status: 'skipped',
      note: step.skipReason ?? `chưa đặt ${step.requiresEnv}`,
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
      const result = { ...blank(step), seconds: (performance.now() - started) / 1000 };
      const skipped = markerReason(output, 'SKIPPED:');
      const notApplicable = markerReason(output, 'NOT_APPLICABLE:');
      if (code !== 0) {
        result.status = 'failed';
        result.firstError = firstErrorLine(output);
      } else if (skipped !== undefined) {
        result.status = 'skipped';
        result.note = skipped;
      } else if (notApplicable !== undefined) {
        result.status = 'not_applicable';
        result.note = notApplicable;
      }
      resolve(result);
    };
    child.on('error', (err) => {
      output += String(err);
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

/** Bước này có làm cả lần chạy không đạt không (data-model.md mục 1). */
const isFailure = (result, ci) => result.status === 'failed' || (ci && result.status === 'skipped');

const formatSeconds = (s) => `${s.toFixed(1).replace('.', ',')} s`;

function printSummary(results, ci) {
  const width = Math.max(18, ...results.map((r) => r.name.length + 2));
  const lines = ['', `${'Bước'.padEnd(width)} Kết quả   Thời gian`];
  for (const r of results) {
    const failed = isFailure(r, ci);
    const status =
      r.status === 'passed'
        ? '✓ đạt'
        : r.status === 'failed'
          ? '✗ lỗi'
          : r.status === 'excepted'
            ? '! ngoại lệ'
            : r.status === 'not_applicable'
              ? '· không áp dụng'
              : failed
                ? '✗ bỏ qua'
                : '– bỏ qua';
    const detail = r.status === 'failed' || r.status === 'excepted' ? r.firstError : r.note;
    const extra = detail ? `   (${detail})` : '';
    lines.push(
      `${r.name.padEnd(width)} ${status.padEnd(9)} ${formatSeconds(r.seconds).padEnd(7)}${extra}`.trimEnd(),
    );
    if (r.status === 'excepted') {
      lines.push(`  ↳ ngoại lệ: ${r.exception.file} – duyệt bởi ${r.exception.approvedBy}`);
    }
    // FR-010: mỗi bước không đạt kèm lệnh chạy lại đúng cổng đó.
    if (failed) {
      if (r.status === 'skipped') {
        lines.push('  ↳ trên CI không bước nào được bỏ qua (FR-008)');
      }
      lines.push(`  ↳ chạy lại: ${r.rerun}`);
    }
  }
  const count = (status) => results.filter((r) => r.status === status).length;
  const failures = results.filter((r) => isFailure(r, ci)).length;
  const ignored = (ci ? 0 : count('skipped')) + count('not_applicable');
  const counted = results.length - ignored;
  const notes = [
    !ci && count('skipped') > 0 ? `${count('skipped')} bỏ qua` : '',
    count('not_applicable') > 0 ? `${count('not_applicable')} không áp dụng` : '',
    count('excepted') > 0 ? `${count('excepted')} ngoại lệ` : '',
  ].filter((n) => n !== '');
  const note = notes.length > 0 ? ` (${notes.join(', ')})` : '';
  const total = results.reduce((sum, r) => sum + r.seconds, 0);
  lines.push(`Tổng thời gian: ${formatSeconds(total)}`);
  lines.push(
    failures > 0
      ? `→ THẤT BẠI: ${failures}/${counted} bước lỗi${note}`
      : `→ ĐẠT: ${counted}/${counted} bước${note}`,
  );
  process.stdout.write(`${lines.join('\n')}\n`);
}

function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/** Ở chế độ ci: cổng không đạt có ngoại lệ hợp lệ còn hạn → `excepted` (FR-009). */
function applyExceptions(results, steps) {
  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length === 0) return;
  const exceptions = loadExceptions({ gateNames: steps.map((s) => s.name) });
  for (const result of failed) {
    const found = findActiveException(exceptions, result.name);
    if (!found) continue;
    result.status = 'excepted';
    result.note = found.file;
    result.exception = { file: found.file, approvedBy: found.data.approvedBy };
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  const steps = selectSteps(options);
  const results = [];
  for (const step of steps) {
    process.stdout.write(`\n▶ ${step.name}\n`);
    results.push(await runStep(step));
  }
  if (options.ci) applyExceptions(results, steps);
  printSummary(results, options.ci);
  const passed = !results.some((r) => isFailure(r, options.ci));
  if (options.report) {
    const report = {
      schema: 1,
      commit: headCommit(),
      mode: options.ci ? 'ci' : 'local',
      results: results.map((r) => ({ ...r, seconds: Math.round(r.seconds * 10) / 10 })),
      passed,
    };
    writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
  }
  return passed ? 0 : 1;
}

// Chạy như lệnh (không chạy khi được nhập từ công cụ khác, vd check-pipeline).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`✖ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
