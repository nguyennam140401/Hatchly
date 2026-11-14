// Đường dẫn gốc dùng chung cho các lệnh `pnpm infra`.
import { join, resolve } from 'node:path';

/** Gốc worktree/repo (tooling/infra/lib → lên ba cấp). */
export const ROOT = resolve(import.meta.dirname, '..', '..', '..');
export const INFRA_DIR = join(ROOT, 'infra');
export const STACKS = ['cloud', 'platform'];

export const stackDir = (stack) => join(INFRA_DIR, 'stacks', stack);
export const envFile = (env, ext) => join(INFRA_DIR, 'envs', `${env}.${ext}`);
export const planDir = (env) => join(INFRA_DIR, '.plans', env);
export const credentialsFile = (env) => join(INFRA_DIR, '.credentials', `${env}.env`);
export const kubeconfigFile = (env) => join(INFRA_DIR, '.credentials', `${env}.kubeconfig`);

/** Khóa trạng thái của một stack; môi trường tạm diễn tập nằm dưới `drill/`. */
export function stateKeyFor(stack, env) {
  return env === 'drill' ? `drill/${stack}.tfstate` : `${stack}.tfstate`;
}
