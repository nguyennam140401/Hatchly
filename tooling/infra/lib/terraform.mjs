// Bọc `terraform` cho `pnpm infra` (T018). Chạy `terraform -chdir=infra/stacks/<stack>` bằng spawn, không qua shell.
// Nhánh khóa dự phòng (R3): khi `<env>.backend.hcl` có `use_lockfile = false` thì CLI tự tạo/xóa đối tượng
// `locks/<stack>.json` quanh mỗi lệnh GHI và từ chối khi khóa đã có.
import { readFileSync } from 'node:fs';
import { loadBackendConfig, needsManualLock } from './backend-config.mjs';
import { CliExit, EXIT } from './exit-codes.mjs';
import { INFRA_DIR, stackDir, stateKeyFor } from './paths.mjs';
import { run } from './process.mjs';
import { createS3 } from './s3.mjs';

export function requiredTerraformVersion() {
  return readFileSync(`${INFRA_DIR}/.terraform-version`, 'utf8').trim();
}

/** Ném `CliExit` (mã 4) nếu thiếu terraform hoặc sai phiên bản; trả phiên bản đang dùng. */
export async function assertTerraform() {
  const need = requiredTerraformVersion();
  let version;
  try {
    const result = await run('terraform', ['version', '-json']);
    if (result.code !== 0) throw new Error('mã thoát khác 0');
    version = JSON.parse(result.stdout).terraform_version;
  } catch {
    throw new CliExit(
      `Không chạy được terraform. Cài Terraform ${need} (infra/.terraform-version) rồi chạy lại.`,
      EXIT.NOT_READY,
    );
  }
  if (version !== need) {
    throw new CliExit(
      `Terraform ${version} khác phiên bản cố định ${need} (infra/.terraform-version). Cài đúng phiên bản.`,
      EXIT.NOT_READY,
    );
  }
  return version;
}

/** Đối số cho `-chdir` và các tệp tương đối theo thư mục stack. */
export function chdirArg(stack) {
  return `-chdir=${stackDir(stack)}`;
}
export const varFileArg = (env) => `-var-file=../../envs/${env}.tfvars`;

/**
 * Chạy `terraform` một lệnh. `capture` → trả stdout; mặc định cho đầu ra ra màn hình.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function tf(stack, args, { env = {}, capture = false } = {}) {
  return run('terraform', [chdirArg(stack), ...args], {
    env: { TF_IN_AUTOMATION: '1', TF_INPUT: '0', ...env },
    inherit: !capture,
  });
}

export function initArgs(env, stack) {
  return [
    'init',
    '-reconfigure',
    '-input=false',
    `-backend-config=../../envs/${env}.backend.hcl`,
    `-backend-config=key=${stateKeyFor(stack, env)}`,
  ];
}

export async function init(stack, env, options = {}) {
  const result = await tf(stack, initArgs(env, stack), { ...options, capture: true });
  if (result.code !== 0)
    throw new CliExit(`terraform init (${stack}) lỗi:\n${result.stderr.trim()}`, EXIT.ERROR);
}

/** Khóa thủ công quanh `fn` khi backend không hỗ trợ `use_lockfile` (V6). */
export async function withLock(stack, env, fn, deps = {}) {
  const backend = deps.backend ?? loadBackendConfig(env);
  if (!needsManualLock(backend)) return await fn();
  const s3 = deps.s3 ?? createS3(env, { backend });
  const key = `locks/${stack}.json`;
  try {
    await s3.putJson(key, { stack, since: new Date().toISOString() }, { onlyIfAbsent: true });
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 412) {
      throw new CliExit(
        `Stack ${stack} đang bị khóa (${key}). Nếu chắc không ai đang chạy, xóa đối tượng khóa rồi chạy lại.`,
        EXIT.BLOCKED,
      );
    }
    throw error;
  }
  try {
    return await fn();
  } finally {
    await s3.deleteObject(key);
  }
}

/** `terraform plan -out` với `-detailed-exitcode`: mã 0 = không đổi, 2 = có thay đổi, 1 = lỗi. */
export function planToFile(
  stack,
  env,
  planFile,
  { vars = {}, replace = [], env: procEnv = {} } = {},
) {
  const extra = [
    ...Object.entries(vars).map(([k, v]) => `-var=${k}=${v}`),
    ...replace.map((address) => `-replace=${address}`),
  ];
  return tf(
    stack,
    ['plan', '-input=false', '-detailed-exitcode', varFileArg(env), ...extra, `-out=${planFile}`],
    {
      env: procEnv,
    },
  );
}

/** `terraform show -json <planFile>` → đối tượng. */
export async function showJson(stack, planFile, options = {}) {
  const result = await tf(stack, ['show', '-json', planFile], { ...options, capture: true });
  if (result.code !== 0)
    throw new CliExit(`terraform show lỗi:\n${result.stderr.trim()}`, EXIT.ERROR);
  return JSON.parse(result.stdout);
}

export function applyFile(stack, planFile, options = {}) {
  return tf(stack, ['apply', '-input=false', planFile], options);
}

/** `terraform output -json` → `{ tên: giá_trị }` (đã bỏ lớp `{ value, type }`). */
export async function output(stack, options = {}) {
  const result = await tf(stack, ['output', '-json'], { ...options, capture: true });
  if (result.code !== 0)
    throw new CliExit(`terraform output (${stack}) lỗi:\n${result.stderr.trim()}`, EXIT.ERROR);
  const raw = JSON.parse(result.stdout || '{}');
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.value]));
}

export async function stateList(stack, options = {}) {
  const result = await tf(stack, ['state', 'list'], { ...options, capture: true });
  if (result.code !== 0) return [];
  return result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}
