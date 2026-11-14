// Dấu định nghĩa và dấu tham số (T089, data-model.md mục 5–6). Băm ổn định qua thứ tự tệp và kiểu xuống dòng
// (Windows CRLF / Linux LF cho cùng giá trị).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { INFRA_DIR, envFile } from './paths.mjs';
import { run } from './process.mjs';

/** Thư mục bỏ qua khi băm: công cụ, và thư mục kiểm thử (đổi kiểm thử không phải đổi hạ tầng). */
const SKIP_DIRS = new Set(['.terraform', 'tests', '.plans']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
    } else out.push(full);
  }
  return out;
}

/** Nội dung tệp với kiểu xuống dòng chuẩn hóa về LF. */
const normalized = (file) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');

export function hashFiles(files, base) {
  const h = createHash('sha256');
  for (const file of files) {
    h.update(`${relative(base, file).replaceAll('\\', '/')}\n`);
    h.update(normalized(file));
    h.update('\n--\n');
  }
  return `sha256:${h.digest('hex')}`;
}

/** Băm `infra/modules/**` và `infra/stacks/**` (gồm `.terraform.lock.hcl`, bỏ `.terraform/` và `tests/`). */
export function definitionHash(infraDir = INFRA_DIR) {
  const files = ['modules', 'stacks'].flatMap((d) => walk(join(infraDir, d)));
  return hashFiles(files, infraDir);
}

/** Băm tệp tham số của đúng môi trường: `<env>.tfvars` + `<env>.backend.hcl`. */
export function paramsHash(env) {
  const files = [envFile(env, 'tfvars'), envFile(env, 'backend.hcl')];
  return hashFiles(files, INFRA_DIR);
}

/** Commit hiện tại và danh sách tệp bẩn trong `infra/`, `tooling/infra/`. */
export async function gitState(deps = {}) {
  const exec = deps.run ?? run;
  const head = await exec('git', ['rev-parse', 'HEAD']);
  const status = await exec('git', ['status', '--porcelain', '--', 'infra', 'tooling/infra']);
  return {
    commit: head.code === 0 ? head.stdout.trim() : 'unknown',
    dirty: status.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  };
}

export const shortHash = (hash) => hash.replace('sha256:', '').slice(0, 12);
