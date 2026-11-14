// Dọn ảnh phát hành cũ trong kho ảnh của một môi trường (008 T088, FR-025).
// Luật giữ: ảnh của 10 lần triển khai release THÀNH CÔNG gần nhất (theo GitHub Deployments) VÀ mọi ảnh dưới 90 ngày;
// ảnh không có bản ghi triển khai nào thì GIỮ (không xóa thứ không dò được nguồn gốc). Xóa phần còn lại qua API kho ảnh
// (OCI Distribution: DELETE /v2/<repo>/manifests/<digest>).
// Dùng: node prune-images.mjs --env staging [--apply]    (mặc định chạy khô: chỉ in danh sách sẽ xóa)
// Biến: GITHUB_TOKEN (đọc Deployments), REGISTRY_USER / REGISTRY_PASSWORD (thông tin `registry` của thư mục môi trường).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const KEEP_RELEASES = 10;
const KEEP_DAYS = 90;
const API = 'https://api.github.com';

/**
 * @param {{ tags: string[], deployments: { sha: string, createdAt: string, kind: string, success: boolean }[], now?: Date }} input
 *   `tags` = thẻ ảnh (mỗi thẻ là SHA commit); `deployments` = mới → cũ.
 * @returns {{ keep: string[], remove: string[] }}
 */
export function selectImages({ tags, deployments, now = new Date() }) {
  const keep = new Set();
  const recentReleases = deployments
    .filter((d) => d.success && d.kind === 'release')
    .slice(0, KEEP_RELEASES)
    .map((d) => d.sha);
  for (const sha of recentReleases) keep.add(sha);
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  const known = new Set(deployments.map((d) => d.sha));
  for (const d of deployments) if (Date.parse(d.createdAt) >= cutoff) keep.add(d.sha);
  // Không có bản ghi nào cho thẻ này → giữ (an toàn).
  for (const tag of tags) if (!known.has(tag)) keep.add(tag);
  return { keep: tags.filter((t) => keep.has(t)), remove: tags.filter((t) => !keep.has(t)) };
}

async function ghJson(path, env, fetchFn) {
  const res = await fetchFn(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub trả HTTP ${res.status}`);
  return res.json();
}

/** Các lần triển khai của môi trường, mới → cũ, kèm trạng thái cuối. */
export async function listDeployments(repo, environment, env, fetchFn = fetch) {
  const items = await ghJson(
    `/repos/${repo}/deployments?environment=${environment}&per_page=100`,
    env,
    fetchFn,
  );
  const out = [];
  for (const d of items) {
    const statuses = await ghJson(
      `/repos/${repo}/deployments/${d.id}/statuses?per_page=1`,
      env,
      fetchFn,
    );
    out.push({
      sha: d.sha,
      createdAt: d.created_at,
      kind: d.payload?.kind ?? 'release',
      success: statuses[0]?.state === 'success',
    });
  }
  return out;
}

async function registry(base, path, auth, fetchFn, init = {}) {
  const res = await fetchFn(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Basic ${auth}`,
      accept:
        'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json',
      ...(init.headers ?? {}),
    },
  });
  return res;
}

async function main(argv, env) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const name = flag('--env');
  const apply = argv.includes('--apply');
  try {
    const { parse } = createRequire(`${root}tooling/package.json`)('yaml');
    const params = parse(readFileSync(`ops/deploy/env/${name}.yaml`, 'utf8'));
    if (!params.provisioned) {
      console.log(`${name} chưa có – không có gì để dọn`);
      return 0;
    }
    const repoPath = params.registry.repository.split('/').slice(1).join('/');
    const host = params.registry.repository.split('/')[0];
    const base = `https://${host}`;
    const auth = Buffer.from(`${env.REGISTRY_USER}:${env.REGISTRY_PASSWORD}`).toString('base64');
    const repo = flag('--repo') ?? env.GITHUB_REPOSITORY ?? 'nguyennam140401/Hatchly';
    const tagsRes = await registry(base, `/v2/${repoPath}/tags/list`, auth, fetch);
    if (!tagsRes.ok) throw new Error(`kho ảnh trả HTTP ${tagsRes.status} khi liệt kê thẻ`);
    const tags = ((await tagsRes.json()).tags ?? []).filter((t) => /^[0-9a-f]{40}$/.test(t));
    const { keep, remove } = selectImages({
      tags,
      deployments: await listDeployments(repo, name, env, fetch),
    });
    console.log(
      `${name}: giữ ${keep.length}, ${apply ? 'xóa' : 'sẽ xóa (chạy khô)'} ${remove.length}`,
    );
    for (const tag of remove) {
      console.log(`  ${apply ? 'xóa' : '·'} ${tag.slice(0, 12)}`);
      if (!apply) continue;
      const head = await registry(base, `/v2/${repoPath}/manifests/${tag}`, auth, fetch, {
        method: 'HEAD',
      });
      const digest = head.headers.get('docker-content-digest');
      if (!head.ok || !digest) throw new Error(`không lấy được digest của ${tag.slice(0, 12)}`);
      const del = await registry(base, `/v2/${repoPath}/manifests/${digest}`, auth, fetch, {
        method: 'DELETE',
      });
      if (!del.ok && del.status !== 404)
        throw new Error(`kho ảnh trả HTTP ${del.status} khi xóa ${tag.slice(0, 12)}`);
    }
    return 0;
  } catch (err) {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
