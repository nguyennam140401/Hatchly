// Tìm pull request phát hành `dev` → `master` đang mở để chạy lại `ci/gates` của nó sau khi `staging` xanh (008 T087, R8):
// `check:release-source` chỉ đạt khi đầu pull request đã triển khai thành công lên test, nên cần chạy lại cổng mà không
// ai phải bấm. Dùng ở cuối lần triển khai staging thành công.
// Dùng: node rerun-release-gates.mjs [--repo <chủ>/<kho>]  → in số pull request (hoặc không in gì nếu không có).
// Jenkinsfile.deploy gọi tiếp `build job: "ci/gates/PR-<số>"` (không chờ). Lỗi gọi API KHÔNG làm hỏng triển khai: in cảnh
// báo ra stderr và thoát mã 0 (không in số).
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';

/** @returns {Promise<number|null>} số pull request dev → master đang mở */
export async function findReleasePullRequest(repo, env = process.env, fetchFn = fetch) {
  const owner = repo.split('/')[0];
  const res = await fetchFn(
    `${API}/repos/${repo}/pulls?state=open&base=master&head=${owner}:dev&per_page=5`,
    {
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    },
  );
  if (!res.ok) throw new Error(`GitHub trả HTTP ${res.status}`);
  const pulls = await res.json();
  return pulls.length > 0 ? pulls[0].number : null;
}

async function main(argv, env) {
  const i = argv.indexOf('--repo');
  const repo = i === -1 ? (env.GITHUB_REPOSITORY ?? 'nguyennam140401/Hatchly') : argv[i + 1];
  if (!env.GITHUB_TOKEN) {
    console.error('! thiếu GITHUB_TOKEN – bỏ qua việc chạy lại ci/gates');
    return 0;
  }
  try {
    const number = await findReleasePullRequest(repo, env);
    if (number !== null) console.log(String(number));
  } catch (err) {
    console.error(
      `! không tìm được pull request phát hành: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
