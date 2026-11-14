// Bản ghi triển khai `DeploymentRecord` trên GitHub Deployments (008 T074, FR-036, data-model.md mục 4).
// Dùng (App "deploy": quyền Deployments ghi + Pull requests đọc, biến GITHUB_TOKEN):
//   node deployment-record.mjs begin  --env staging --sha <sha> [--state deploy-state.json]
//   node deployment-record.mjs step   --name rollout --status passed --seconds 12 [--state ...]
//   node deployment-record.mjs finish --result succeeded|rolled_back|stopped_before_change|no_target \
//        --kind release|hotfix|redeploy --image-repository r --image-digest sha256:… [--image-reused] \
//        --gates-passed true --excepted lint,... --vuln-critical 0 --vuln-fixable 0 --vuln-blocked false \
//        --migrations 0014_x.sql,... --job deploy/staging/deploy --build 57 --url https://… \
//        --previous-commit sha --previous-digest sha256:… --previous-helm-revision 3 [--rolled-back] \
//        --notify-errors "…" [--redeploy-by ten --redeploy-reason "…" --redeploy-version sha] [--dry-run]
//   node deployment-record.mjs last-success --env staging       → in bản ghi (JSON) của lần thành công gần nhất
// Giới hạn của GitHub: `payload` của Deployment KHÔNG sửa được sau khi tạo, nên bản ghi đầy đủ được tạo MỘT LẦN ở
// `finish` (cùng trạng thái cuối). `begin`/`step` chỉ ghi tệp trạng thái cục bộ (thời điểm bắt đầu, các bước).
// `no_target` KHÔNG tạo Deployment. Bản ghi KHÔNG chứa bí mật, nhật ký thô hay địa chỉ nội bộ ngoài đường dẫn Jenkins.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';
const ENVIRONMENTS = ['staging', 'production'];
const KINDS = ['release', 'hotfix', 'redeploy'];

/** Ánh xạ kết quả → trạng thái GitHub (data-model.md mục 4). `null` = không tạo Deployment. */
export function statusFor(result, failedStep) {
  switch (result) {
    case 'succeeded':
      return { state: 'success', description: 'Triển khai thành công' };
    case 'rolled_back':
      return { state: 'failure', description: 'Đã quay về bản trước' };
    case 'stopped_before_change':
      return {
        state: 'failure',
        description: `Dừng trước khi đổi môi trường: hỏng ở bước ${failedStep ?? '?'}`,
      };
    case 'no_target':
      return null;
    default:
      throw new Error(`Kết quả không hợp lệ: ${result}`);
  }
}

const list = (value) =>
  value
    ? String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
const bool = (value) => value === true || value === 'true';

/**
 * Dựng bản ghi đúng lược đồ DeploymentRecord (schema: 1) – ném lỗi khi thiếu/sai trường bắt buộc.
 * @param {object} a các giá trị đã gom (từ cờ + tệp trạng thái + GitHub)
 */
export function buildRecord(a) {
  if (!ENVIRONMENTS.includes(a.environment))
    throw new Error(`environment phải thuộc ${ENVIRONMENTS.join('|')}`);
  if (!KINDS.includes(a.kind)) throw new Error(`kind phải thuộc ${KINDS.join('|')}`);
  if (!/^[0-9a-f]{40}$/.test(a.commit ?? '')) throw new Error('commit phải là SHA đầy đủ 40 ký tự');
  const record = {
    schema: 1,
    environment: a.environment,
    kind: a.kind,
    commit: a.commit,
    image: {
      repository: a.image?.repository ?? '',
      digest: a.image?.digest ?? '',
      reused: Boolean(a.image?.reused),
    },
    mergedBy: a.mergedBy ?? null,
    approvedBy: a.approvedBy ?? [],
    pullRequest: a.pullRequest ?? null,
    jenkins: { job: a.jenkins?.job ?? '', build: a.jenkins?.build ?? 0, url: a.jenkins?.url ?? '' },
    gates: { passed: Boolean(a.gates?.passed), excepted: a.gates?.excepted ?? [] },
    vulnerabilities: {
      critical: a.vulnerabilities?.critical ?? 0,
      criticalFixable: a.vulnerabilities?.criticalFixable ?? 0,
      blocked: Boolean(a.vulnerabilities?.blocked),
    },
    migrations: a.migrations ?? [],
    steps: a.steps ?? [],
    rolledBack: Boolean(a.rolledBack),
    previous: a.previous ?? null,
    redeploy: a.kind === 'redeploy' ? (a.redeploy ?? null) : null,
    notifyErrors: a.notifyErrors ?? [],
  };
  return record;
}

async function github(path, env, fetchFn, init = {}) {
  const res = await fetchFn(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok)
    throw new Error(
      `GitHub trả HTTP ${res.status} cho ${init.method ?? 'GET'} ${path.split('?')[0]}`,
    );
  return res.status === 204 ? undefined : res.json();
}

/** Người hợp nhất, người duyệt và số pull request chứa commit (nếu có). */
export async function pullRequestInfo(repo, sha, env, fetchFn = fetch) {
  const pulls = await github(`/repos/${repo}/commits/${sha}/pulls`, env, fetchFn);
  const pr = pulls.find((p) => p.merged_at) ?? pulls[0];
  if (!pr) return { mergedBy: null, approvedBy: [], pullRequest: null, headRef: null };
  const detail = await github(`/repos/${repo}/pulls/${pr.number}`, env, fetchFn);
  const reviews = await github(
    `/repos/${repo}/pulls/${pr.number}/reviews?per_page=100`,
    env,
    fetchFn,
  );
  const approvedBy = [
    ...new Set(reviews.filter((r) => r.state === 'APPROVED').map((r) => r.user.login)),
  ];
  return {
    mergedBy: detail.merged_by?.login ?? null,
    approvedBy,
    pullRequest: pr.number,
    headRef: detail.head?.ref ?? null,
  };
}

/** Tạo Deployment + trạng thái cuối; trả id (hoặc undefined khi `no_target`). */
export async function createDeployment(
  { repo, record, result, failedStep, logUrl },
  env,
  fetchFn = fetch,
) {
  const status = statusFor(result, failedStep);
  if (status === null) return undefined;
  const deployment = await github(`/repos/${repo}/deployments`, env, fetchFn, {
    method: 'POST',
    body: JSON.stringify({
      ref: record.commit,
      environment: record.environment,
      auto_merge: false,
      required_contexts: [],
      description: `${record.kind} ${record.commit.slice(0, 12)}`,
      payload: record,
      transient_environment: record.environment === 'staging',
      production_environment: record.environment === 'production',
    }),
  });
  await github(`/repos/${repo}/deployments/${deployment.id}/statuses`, env, fetchFn, {
    method: 'POST',
    body: JSON.stringify({
      state: status.state,
      description: status.description.slice(0, 140),
      log_url: logUrl,
      environment: record.environment,
    }),
  });
  return deployment.id;
}

/** `hotfix` khi pull request nguồn nằm trên nhánh `hotfix/*`, ngược lại `release` (T086). */
export function kindFor(headRef) {
  return typeof headRef === 'string' && headRef.startsWith('hotfix/') ? 'hotfix' : 'release';
}

/** Bản ghi của lần triển khai THÀNH CÔNG của đúng commit `sha` lên môi trường, hoặc null (dùng cho redeploy). */
export async function findSuccess(repo, environment, sha, env, fetchFn = fetch) {
  const deployments = await github(
    `/repos/${repo}/deployments?environment=${environment}&sha=${sha}&per_page=30`,
    env,
    fetchFn,
  );
  for (const d of deployments) {
    const statuses = await github(
      `/repos/${repo}/deployments/${d.id}/statuses?per_page=1`,
      env,
      fetchFn,
    );
    if (statuses[0]?.state === 'success') return d.payload;
  }
  return null;
}

/** Bản ghi (payload) của lần triển khai thành công gần nhất của môi trường, hoặc null. */
export async function lastSuccess(repo, environment, env, fetchFn = fetch) {
  const deployments = await github(
    `/repos/${repo}/deployments?environment=${environment}&per_page=30`,
    env,
    fetchFn,
  );
  for (const d of deployments) {
    const statuses = await github(
      `/repos/${repo}/deployments/${d.id}/statuses?per_page=1`,
      env,
      fetchFn,
    );
    if (statuses[0]?.state === 'success') return d.payload;
  }
  return null;
}

function parse(argv) {
  const out = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const readState = (file) =>
  existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { steps: [] };

async function main(argv, env) {
  const [command] = argv;
  const f = parse(argv);
  const stateFile = f.state ?? 'deploy-state.json';
  const repo = f.repo ?? env.GITHUB_REPOSITORY ?? 'nguyennam140401/Hatchly';
  try {
    if (command === 'begin') {
      writeFileSync(
        stateFile,
        JSON.stringify({
          startedAt: new Date().toISOString(),
          environment: f.env,
          commit: f.sha,
          steps: [],
        }),
      );
      return 0;
    }
    if (command === 'step') {
      const state = readState(stateFile);
      state.steps.push({ name: f.name, status: f.status, seconds: Number(f.seconds ?? 0) });
      writeFileSync(stateFile, JSON.stringify(state));
      return 0;
    }
    if (command === 'kind') {
      const info = env.GITHUB_TOKEN ? await pullRequestInfo(repo, f.sha, env) : { headRef: null };
      console.log(kindFor(info.headRef));
      return 0;
    }
    if (command === 'find-success') {
      if (!env.GITHUB_TOKEN) throw new Error('thiếu GITHUB_TOKEN');
      console.log(JSON.stringify(await findSuccess(repo, f.env, f.sha, env)));
      return 0;
    }
    if (command === 'last-success') {
      if (!env.GITHUB_TOKEN) throw new Error('thiếu GITHUB_TOKEN');
      console.log(JSON.stringify(await lastSuccess(repo, f.env, env)));
      return 0;
    }
    if (command === 'finish') {
      const state = readState(stateFile);
      const pr =
        f['dry-run'] || !env.GITHUB_TOKEN
          ? { mergedBy: null, approvedBy: [], pullRequest: null }
          : await pullRequestInfo(repo, state.commit, env);
      const record = buildRecord({
        environment: state.environment,
        kind: f.kind ?? 'release',
        commit: state.commit,
        image: {
          repository: f['image-repository'],
          digest: f['image-digest'],
          reused: bool(f['image-reused']),
        },
        ...pr,
        jenkins: { job: f.job, build: Number(f.build ?? 0), url: f.url },
        gates: { passed: bool(f['gates-passed']), excepted: list(f.excepted) },
        vulnerabilities: {
          critical: Number(f['vuln-critical'] ?? 0),
          criticalFixable: Number(f['vuln-fixable'] ?? 0),
          blocked: bool(f['vuln-blocked']),
        },
        migrations: list(f.migrations),
        steps: state.steps,
        rolledBack: bool(f['rolled-back']),
        previous: f['previous-commit']
          ? {
              commit: f['previous-commit'],
              digest: f['previous-digest'] ?? '',
              helmRevision: Number(f['previous-helm-revision'] ?? 0),
            }
          : null,
        redeploy: f['redeploy-by']
          ? {
              requestedBy: f['redeploy-by'],
              reason: f['redeploy-reason'] ?? '',
              version: f['redeploy-version'] ?? '',
            }
          : null,
        notifyErrors: f['notify-errors'] ? [String(f['notify-errors'])] : [],
      });
      if (f['dry-run']) {
        console.log(JSON.stringify(record, null, 2));
        return 0;
      }
      if (!env.GITHUB_TOKEN) throw new Error('thiếu GITHUB_TOKEN');
      const failed = state.steps.find((s) => s.status === 'failed')?.name;
      const id = await createDeployment(
        { repo, record, result: f.result, failedStep: failed, logUrl: f.url },
        env,
      );
      console.log(
        id === undefined ? 'không tạo Deployment (chưa có môi trường đích)' : `deployment=${id}`,
      );
      return 0;
    }
    console.error('✖ lệnh phải là begin | step | finish | last-success');
    return 2;
  } catch (err) {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
