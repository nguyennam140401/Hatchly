// Tính các biến môi trường cho `pnpm verify --ci` trên Jenkins (008 T055, contracts/quality-gates.md mục 4, 7).
// Dùng quyền ĐỌC của GitHub App "ci" (biến GITHUB_TOKEN) để lấy từ GitHub Deployments SHA triển khai thành công gần
// nhất của `staging` và `production`, rồi in các dòng KEY=VALUE:
//   STAGING_DEPLOYED_SHA  – SHA staging đang chạy (hoặc `none` nếu chưa từng triển khai)
//   COMPAT_BASE_SHA       – đích `dev` → bản đang chạy ở staging; đích `master` → bản đang chạy ở production; chưa có → `none`
//   GATE_TARGET_BRANCH / GATE_SOURCE_BRANCH, MIGRATION_BASE_REF=origin/<đích>, APP_VERSION=<sha12 của commit đang kiểm>
// Dùng: node resolve-gate-env.mjs --target dev --source feature/x --sha <commit> [--repo <chủ>/<kho>]
// Không in mã truy cập, không ghi gì ra đĩa. Mã thoát 0; lỗi gọi GitHub → 2 (không đoán `none` khi chưa biết).
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';

async function github(path, env, fetchFn) {
  const res = await fetchFn(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub trả HTTP ${res.status} cho ${path.split('?')[0]}`);
  return res.json();
}

/**
 * SHA triển khai thành công gần nhất của một môi trường, hoặc `none`.
 * Duyệt các Deployment mới → cũ, lấy trạng thái mới nhất của từng cái.
 */
export async function lastSuccessfulSha(repo, environment, env, fetchFn = fetch) {
  const deployments = await github(
    `/repos/${repo}/deployments?environment=${encodeURIComponent(environment)}&per_page=30`,
    env,
    fetchFn,
  );
  for (const deployment of deployments) {
    const statuses = await github(
      `/repos/${repo}/deployments/${deployment.id}/statuses?per_page=1`,
      env,
      fetchFn,
    );
    if (statuses[0]?.state === 'success') return deployment.sha;
  }
  return 'none';
}

/**
 * @param {{target: string, source: string, sha: string, repo: string}} input
 * @returns {Promise<Record<string, string>>}
 */
export async function resolve(input, env = process.env, fetchFn = fetch) {
  const [staging, production] = await Promise.all([
    lastSuccessfulSha(input.repo, 'staging', env, fetchFn),
    lastSuccessfulSha(input.repo, 'production', env, fetchFn),
  ]);
  return {
    STAGING_DEPLOYED_SHA: staging,
    COMPAT_BASE_SHA: input.target === 'master' ? production : staging,
    GATE_TARGET_BRANCH: input.target,
    GATE_SOURCE_BRANCH: input.source,
    MIGRATION_BASE_REF: `origin/${input.target}`,
    APP_VERSION: input.sha.slice(0, 12),
  };
}

async function main(argv, env) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const target = flag('--target');
  const source = flag('--source');
  const sha = flag('--sha');
  const repo = flag('--repo') ?? env.GITHUB_REPOSITORY ?? 'nguyennam140401/Hatchly';
  if (!target || !source || !sha || !env.GITHUB_TOKEN) {
    console.error('✖ cần --target, --source, --sha và biến GITHUB_TOKEN');
    return 2;
  }
  try {
    const values = await resolve({ target, source, sha, repo }, env);
    for (const [key, value] of Object.entries(values)) console.log(`${key}=${value}`);
    return 0;
  } catch (err) {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
