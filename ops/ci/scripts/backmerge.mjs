// Đưa bản sửa nóng về `dev` (008 T084, FR-033, contracts/deploy-pipeline.md mục 7): tạo nhánh `backmerge/<sha12>` từ đầu
// `master`, mở pull request vào `dev` tiêu đề "Backmerge sửa nóng <sha12>", gắn nhãn `backmerge`. Có xung đột → pull request
// VẪN MỞ và thêm nhãn `needs-manual-merge`. Đã có pull request cùng nhánh → không tạo trùng (chạy lại an toàn).
// Dùng (App "deploy": Contents ghi chỉ cho backmerge/*, Pull requests ghi; biến GITHUB_TOKEN):
//   node backmerge.mjs --sha <sha master vừa triển khai> [--repo <chủ>/<kho>]
// In: `pr=<số> conflict=<true|false> created=<true|false>`. Mã thoát 0; lỗi gọi API → 1.
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function gh(path, env, fetchFn, init = {}) {
  const res = await fetchFn(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  return {
    status: res.status,
    body: res.status === 204 ? undefined : await res.json().catch(() => undefined),
  };
}

const must = (r, what) => {
  if (r.status >= 300) throw new Error(`GitHub trả HTTP ${r.status} khi ${what}`);
  return r.body;
};

/**
 * @param {{repo: string, sha: string, wait?: (ms:number)=>Promise<void>}} o
 * @returns {Promise<{pr: number, conflict: boolean, created: boolean}>}
 */
export async function backmerge(o, env = process.env, fetchFn = fetch) {
  const wait = o.wait ?? sleep;
  const sha12 = o.sha.slice(0, 12);
  const branch = `backmerge/${sha12}`;
  const owner = o.repo.split('/')[0];

  // 1. Nhánh backmerge/<sha12> từ đầu master (đã có thì dùng lại).
  const master = must(
    await gh(`/repos/${o.repo}/git/ref/heads/master`, env, fetchFn),
    'đọc nhánh master',
  );
  const ref = await gh(`/repos/${o.repo}/git/ref/heads/${branch}`, env, fetchFn);
  if (ref.status === 404) {
    must(
      await gh(`/repos/${o.repo}/git/refs`, env, fetchFn, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: master.object.sha }),
      }),
      `tạo nhánh ${branch}`,
    );
  } else must(ref, `đọc nhánh ${branch}`);

  // 2. Pull request: đã có thì không tạo trùng.
  const existing = must(
    await gh(`/repos/${o.repo}/pulls?state=open&head=${owner}:${branch}&base=dev`, env, fetchFn),
    'tìm pull request backmerge',
  );
  let number;
  let created = false;
  if (existing.length > 0) number = existing[0].number;
  else {
    const pr = must(
      await gh(`/repos/${o.repo}/pulls`, env, fetchFn, {
        method: 'POST',
        body: JSON.stringify({
          title: `Backmerge sửa nóng ${sha12}`,
          head: branch,
          base: 'dev',
          body: `Đưa bản sửa nóng ${sha12} (đã triển khai lên production) về dev. Tự mở bởi Jenkins (008).`,
        }),
      }),
      'mở pull request backmerge',
    );
    number = pr.number;
    created = true;
  }

  // 3. Nhãn `backmerge`; xung đột → thêm `needs-manual-merge` (GitHub tính `mergeable` bất đồng bộ nên thăm dò ngắn).
  let conflict = false;
  for (let i = 0; i < 10; i++) {
    const detail = must(
      await gh(`/repos/${o.repo}/pulls/${number}`, env, fetchFn),
      'đọc pull request',
    );
    if (detail.mergeable !== null && detail.mergeable !== undefined) {
      conflict = detail.mergeable === false;
      break;
    }
    await wait(2000);
  }
  const labels = conflict ? ['backmerge', 'needs-manual-merge'] : ['backmerge'];
  must(
    await gh(`/repos/${o.repo}/issues/${number}/labels`, env, fetchFn, {
      method: 'POST',
      body: JSON.stringify({ labels }),
    }),
    'gắn nhãn',
  );
  return { pr: number, conflict, created };
}

async function main(argv, env) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const sha = flag('--sha');
  if (!sha || !env.GITHUB_TOKEN) {
    console.error('✖ cần --sha và biến GITHUB_TOKEN');
    return 1;
  }
  try {
    const r = await backmerge(
      { repo: flag('--repo') ?? env.GITHUB_REPOSITORY ?? 'nguyennam140401/Hatchly', sha },
      env,
    );
    console.log(`pr=${r.pr} conflict=${r.conflict} created=${r.created}`);
    return 0;
  } catch (err) {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
