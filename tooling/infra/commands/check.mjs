// `pnpm infra check` – kiểm tra tĩnh, không cần tài khoản đám mây (T023, contracts/infra-cli.md mục 3, FR-027).
// Chạy lần lượt 7 bước, KHÔNG dừng ở lỗi đầu, rồi in bảng tổng kết cùng kiểu `pnpm verify`.
// Thiếu `terraform`/`tflint` → bước cần chúng "bỏ qua" và lệnh in `SKIPPED: <lý do>`, thoát 0; riêng `CI=true` thì
// thiếu công cụ là lỗi (thoát 1).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from '../lib/exit-codes.mjs';
import { INFRA_DIR, ROOT, STACKS, envFile, stackDir } from '../lib/paths.mjs';
import { checkParams, parseTfvars } from '../lib/params-diff.mjs';
import { commandExists, run as exec } from '../lib/process.mjs';
import { requiredTerraformVersion } from '../lib/terraform.mjs';

const ENVS = ['staging', 'production'];

// Mã màu ANSI trong đầu ra của terraform/tflint.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/** Tóm tắt dòng lỗi đầu tiên đáng chú ý của một đoạn đầu ra. */
function firstLine(text) {
  const lines = text
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const hit = lines.find((l) => /error|lỗi|fail|✖/i.test(l)) ?? lines.at(-1) ?? '';
  return hit.length > 110 ? `${hit.slice(0, 107)}...` : hit;
}

async function capture(command, args, options) {
  const r = await exec(command, args, options);
  return { ...r, text: `${r.stdout}\n${r.stderr}` };
}

/** Các bước; mỗi bước trả `{ ok, detail }` hoặc `{ skipped, detail }`. `tools` cho biết công cụ nào chạy được. */
export function buildSteps(tools) {
  const tf = (stack, args) =>
    capture('terraform', [`-chdir=${stackDir(stack)}`, ...args], {
      env: { TF_IN_AUTOMATION: '1' },
    });
  const needTerraform = (fn) => async () =>
    tools.terraform ? await fn() : { skipped: true, detail: 'chưa cài terraform' };

  return [
    {
      name: 'terraform fmt',
      run: needTerraform(async () => {
        const r = await capture('terraform', ['fmt', '-check', '-recursive', INFRA_DIR]);
        return {
          ok: r.code === 0,
          detail: r.code === 0 ? '' : `tệp chưa định dạng: ${firstLine(r.text)}`,
        };
      }),
    },
    {
      name: 'terraform validate',
      run: needTerraform(async () => {
        for (const stack of STACKS) {
          const init = await tf(stack, ['init', '-backend=false', '-input=false']);
          if (init.code !== 0)
            return { ok: false, detail: `init ${stack}: ${firstLine(init.text)}` };
          const v = await tf(stack, ['validate', '-no-color']);
          if (v.code !== 0) return { ok: false, detail: `validate ${stack}: ${firstLine(v.text)}` };
        }
        return { ok: true, detail: '' };
      }),
    },
    {
      name: 'tflint',
      run: async () => {
        if (!tools.tflint) return { skipped: true, detail: 'chưa cài tflint' };
        const r = await capture('tflint', [
          `--chdir=${INFRA_DIR}`,
          '--recursive',
          '--config',
          join(INFRA_DIR, '.tflint.hcl'),
        ]);
        return { ok: r.code === 0, detail: r.code === 0 ? '' : firstLine(r.text) };
      },
    },
    {
      name: 'terraform test',
      run: needTerraform(async () => {
        for (const stack of STACKS) {
          if (!existsSync(join(stackDir(stack), 'tests'))) continue;
          const r = await tf(stack, ['test', '-test-directory=tests', '-no-color']);
          if (r.code !== 0) return { ok: false, detail: `${stack}: ${firstLine(r.text)}` };
        }
        // Nạp nguyên tệp tham số từng môi trường qua mọi `validation` (chỉ stack cloud).
        if (existsSync(join(stackDir('cloud'), 'tests', 'env-load'))) {
          for (const env of ENVS) {
            const r = await tf('cloud', [
              'test',
              '-test-directory=tests/env-load',
              `-var-file=../../envs/${env}.tfvars`,
              '-no-color',
            ]);
            if (r.code !== 0) return { ok: false, detail: `env-load ${env}: ${firstLine(r.text)}` };
          }
        }
        return { ok: true, detail: '' };
      }),
    },
    {
      name: 'tham số + biến chung',
      run: async () => {
        const problems = [];
        try {
          const [a, b] = ENVS.map((env) =>
            parseTfvars(readFileSync(envFile(env, 'tfvars'), 'utf8')),
          );
          problems.push(...checkParams(a, b));
        } catch (error) {
          problems.push(error instanceof Error ? error.message : 'không đọc được tệp tham số');
        }
        const [cloud, platform] = STACKS.map((s) => join(stackDir(s), 'variables.shared.tf'));
        if (existsSync(cloud) && existsSync(platform)) {
          if (!readFileSync(cloud).equals(readFileSync(platform))) {
            problems.push(
              'variables.shared.tf của hai stack khác nhau (phải giống từng byte): chép bản cloud sang platform.',
            );
          }
        } else problems.push('thiếu variables.shared.tf ở một trong hai stack');
        return { ok: problems.length === 0, detail: problems[0] ?? '', all: problems };
      },
    },
    {
      name: 'quét bí mật',
      run: async () => {
        const r = await capture(
          process.execPath,
          [
            join(ROOT, 'tooling', 'scan-secrets.mjs'),
            'infra',
            'tooling/infra',
            '.github/workflows',
          ],
          { cwd: ROOT },
        );
        return { ok: r.code === 0, detail: r.code === 0 ? '' : firstLine(r.text) };
      },
    },
    {
      name: 'vitest tooling/test/infra',
      run: async () => {
        const vitest = join(ROOT, 'tooling', 'node_modules', 'vitest', 'vitest.mjs');
        const r = await capture(process.execPath, [vitest, 'run', 'test/infra'], {
          cwd: join(ROOT, 'tooling'),
        });
        return { ok: r.code === 0, detail: r.code === 0 ? '' : firstLine(r.text) };
      },
    },
  ];
}

export function summarize(results) {
  const width = Math.max(26, ...results.map((r) => r.name.length + 2));
  const lines = ['', `${'Bước'.padEnd(width)} Kết quả`];
  for (const r of results) {
    const status = r.skipped ? '– bỏ qua' : r.ok ? '✓ đạt' : '✗ lỗi';
    const extra = r.skipped || !r.ok ? `   (${r.detail})` : '';
    lines.push(`${r.name.padEnd(width)} ${status}${extra}`.trimEnd());
  }
  const failed = results.filter((r) => !r.skipped && !r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;
  const counted = results.length - skipped;
  const note = skipped > 0 ? ` (${skipped} bỏ qua)` : '';
  lines.push(
    failed > 0
      ? `→ THẤT BẠI: ${failed}/${counted} bước lỗi${note}`
      : `→ ĐẠT: ${counted}/${counted} bước${note}`,
  );
  return { text: lines.join('\n'), failed, skipped };
}

export async function runChecks(tools, io = { out: (m) => process.stdout.write(`${m}\n`) }) {
  const results = [];
  for (const step of buildSteps(tools)) {
    io.out(`\n▶ ${step.name}`);
    const r = await step.run();
    results.push({ name: step.name, ...r });
    if (r.all !== undefined) for (const p of r.all) io.out(`  ✖ ${p}`);
  }
  const { text, failed, skipped } = summarize(results);
  io.out(text);
  const ci = process.env.CI === 'true';
  if (skipped > 0 && ci) {
    io.out('✖ CI=true: thiếu công cụ (terraform/tflint) là lỗi.');
    return EXIT.ERROR;
  }
  if (failed > 0) return EXIT.ERROR;
  if (skipped > 0) {
    const why = results.filter((r) => r.skipped).map((r) => r.detail);
    io.out(
      `SKIPPED: ${[...new Set(why)].join('; ')} – cài đủ công cụ để kiểm tra trọn vẹn (infra/README.md)`,
    );
  }
  return EXIT.OK;
}

export async function run() {
  const required = requiredTerraformVersion();
  const [terraform, tflint] = await Promise.all([
    commandExists('terraform', ['version']),
    commandExists('tflint', ['--version']),
  ]);
  if (terraform) {
    const v = await terraformVersion();
    if (v !== null && v !== required) {
      process.stdout.write(
        `✖ terraform ${v} khác phiên bản cố định ${required} (infra/.terraform-version)\n`,
      );
      return EXIT.ERROR;
    }
  }
  return await runChecks({ terraform, tflint });
}

async function terraformVersion() {
  try {
    const r = await capture('terraform', ['version', '-json']);
    return JSON.parse(r.stdout).terraform_version;
  } catch {
    return null;
  }
}
