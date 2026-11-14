// Phiên làm việc chung cho các lệnh cần chạm hạ tầng thật: kiểm công cụ, nạp hồ sơ chứng thực, xác minh đúng môi
// trường, dựng biến môi trường cho tiến trình con (terraform, kubectl).
import { CliExit, EXIT } from './exit-codes.mjs';
import { assertCredentialsMatchEnv, loadCredentials } from './credentials.mjs';
import { kubeconfigFile } from './paths.mjs';
import { run } from './process.mjs';
import { assertTerraform } from './terraform.mjs';

/** Biến môi trường cho tiến trình con. Khóa nhà cung cấp đi qua `TF_VAR_…` (biến `sensitive` của stack cloud). */
export function buildProcEnv(env, creds) {
  return {
    ...creds,
    TF_VAR_vngcloud_client_id: creds.VNGCLOUD_CLIENT_ID,
    TF_VAR_vngcloud_client_secret: creds.VNGCLOUD_CLIENT_SECRET,
    KUBECONFIG: kubeconfigFile(env),
    KUBE_CONFIG_PATH: kubeconfigFile(env),
  };
}

/**
 * @param {string} env
 * @param {{ verifyProject?: boolean, deps?: object }} [options]
 *   `verifyProject: false` bỏ bước gọi API xác minh project (dùng cho lệnh chỉ đọc cục bộ/kiểm thử).
 */
export async function openSession(env, { verifyProject = true, deps = {} } = {}) {
  await (deps.assertTerraform ?? assertTerraform)();
  const creds = (deps.loadCredentials ?? loadCredentials)(env);
  if (verifyProject)
    await (deps.assertCredentialsMatchEnv ?? assertCredentialsMatchEnv)(env, creds);
  return { env, creds, procEnv: buildProcEnv(env, creds) };
}

/** Cây git sạch trong `infra/` và `tooling/infra/` (lớp chặn chung của plan/apply). Bẩn → thoát 3 kèm danh sách tệp. */
export async function assertCleanTree(deps = {}) {
  const exec = deps.run ?? run;
  const r = await exec('git', ['status', '--porcelain', '--', 'infra', 'tooling/infra']);
  if (r.code !== 0) throw new CliExit('Không đọc được trạng thái git.', EXIT.ERROR);
  const dirty = r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (dirty.length > 0) {
    throw new CliExit(
      `Có thay đổi chưa commit trong infra/ hoặc tooling/infra/ – commit trước khi chạy (để bản ghi truy vết được):\n  ${dirty.slice(0, 15).join('\n  ')}`,
      EXIT.BLOCKED,
    );
  }
}

export async function currentCommit(deps = {}) {
  const r = await (deps.run ?? run)('git', ['rev-parse', 'HEAD']);
  return r.code === 0 ? r.stdout.trim() : 'unknown';
}
