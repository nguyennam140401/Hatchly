// Gộp báo cáo GateResult của các làn rồi đăng kiểm tra lên pull request (008 T056, FR-010, quality-gates.md mục 3).
// Mỗi kiểm tra KHÔNG viết logic nào trong Groovy: Jenkinsfile.ci chỉ gọi tập lệnh này.
// Dùng: node post-gate-checks.mjs --sha <commit> --build-url <url nhật ký> [--repo <chủ>/<kho>] [--dry-run] <báo cáo.json>...
//   - `gate/<bước>`: mỗi bước một kiểm tra; không đạt hiện đủ bốn thứ: tên cổng · dòng lỗi đầu · đường dẫn nhật ký ·
//     lệnh chạy lại. Bước có ngoại lệ → kết luận `neutral`, tiêu đề "VƯỢT CỔNG (ngoại lệ) – duyệt bởi …".
//   - `ci/gates`: kiểm tra tổng, `success` khi mọi báo cáo `passed` (đây là kiểm tra DUY NHẤT bắt buộc).
// Biến môi trường: GITHUB_TOKEN (mã cài đặt của GitHub App "ci", quyền Checks: ghi). Mã thoát: 0 nếu đăng được và
// mọi cổng đạt; 1 nếu có cổng không đạt; 2 nếu không đăng được.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';

/** Gộp nhiều báo cáo; cùng một bước xuất hiện ở hai làn thì giữ kết quả xấu hơn. */
export function mergeReports(reports) {
  const rank = { passed: 0, not_applicable: 0, excepted: 1, skipped: 2, failed: 3 };
  const byName = new Map();
  for (const report of reports) {
    for (const r of report.results ?? []) {
      const old = byName.get(r.name);
      if (!old || (rank[r.status] ?? 3) > (rank[old.status] ?? 3)) byName.set(r.name, r);
    }
  }
  const results = [...byName.values()];
  const mode = reports.find((r) => r.mode)?.mode ?? 'ci';
  const bad = (r) => r.status === 'failed' || (mode === 'ci' && r.status === 'skipped');
  return {
    results,
    passed: results.every((r) => !bad(r)) && reports.every((r) => r.passed !== false),
  };
}

const ICON = {
  passed: '✓',
  failed: '✗',
  skipped: '– bỏ qua',
  excepted: '! ngoại lệ',
  not_applicable: '· không áp dụng',
};

/** Dựng danh sách kiểm tra (chưa gọi mạng). */
export function buildChecks(merged, { buildUrl }) {
  const checks = merged.results.map((r) => {
    const failed = r.status === 'failed' || r.status === 'skipped';
    const conclusion = r.status === 'excepted' ? 'neutral' : failed ? 'failure' : 'success';
    const title =
      r.status === 'excepted'
        ? `VƯỢT CỔNG (ngoại lệ) – duyệt bởi ${r.exception?.approvedBy ?? '?'}`
        : failed
          ? `${r.name} KHÔNG ĐẠT`
          : `${r.name} ${ICON[r.status] ?? r.status}`;
    const lines = [`Cổng: ${r.name}`];
    if (failed || r.status === 'excepted') {
      lines.push(`Dòng lỗi đầu: ${r.firstError || '(không có)'}`);
      lines.push(`Nhật ký: ${buildUrl}`);
      lines.push(`Chạy lại: ${r.rerun}`);
    }
    if (r.status === 'excepted' && r.exception?.file) lines.push(`Ngoại lệ: ${r.exception.file}`);
    if (r.note) lines.push(`Ghi chú: ${r.note}`);
    return { name: `gate/${r.name}`, conclusion, title, summary: lines.join('\n') };
  });
  const table = merged.results
    .map(
      (r) =>
        `| ${r.name} | ${ICON[r.status] ?? r.status} | ${Number(r.seconds ?? 0).toFixed(1)} s |`,
    )
    .join('\n');
  checks.push({
    name: 'ci/gates',
    conclusion: merged.passed ? 'success' : 'failure',
    title: merged.passed ? 'Mọi cổng đạt' : 'Có cổng không đạt',
    summary: `| Bước | Kết quả | Thời gian |\n|---|---|---|\n${table}\n\nNhật ký: ${buildUrl}`,
  });
  return checks;
}

async function post(repo, sha, check, env, fetchFn) {
  const res = await fetchFn(`${API}/repos/${repo}/check-runs`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({
      name: check.name,
      head_sha: sha,
      status: 'completed',
      conclusion: check.conclusion,
      output: { title: check.title, summary: check.summary },
    }),
  });
  if (!res.ok) throw new Error(`GitHub trả HTTP ${res.status} khi đăng ${check.name}`);
}

export async function run(
  { sha, repo, buildUrl, files, dryRun },
  env = process.env,
  fetchFn = fetch,
) {
  const merged = mergeReports(files.map((f) => JSON.parse(readFileSync(f, 'utf8'))));
  const checks = buildChecks(merged, { buildUrl });
  for (const c of checks) console.log(`${c.name}: ${c.conclusion} – ${c.title}`);
  if (dryRun) return merged.passed ? 0 : 1;
  if (!env.GITHUB_TOKEN) {
    console.error('✖ thiếu GITHUB_TOKEN');
    return 2;
  }
  try {
    for (const c of checks) await post(repo, sha, c, env, fetchFn);
  } catch (err) {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  return merged.passed ? 0 : 1;
}

async function main(argv, env) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const files = argv.filter((a, i) => a.endsWith('.json') && argv[i - 1] !== '--repo');
  const sha = flag('--sha');
  if (!sha || files.length === 0) {
    console.error('✖ cần --sha và ít nhất một tệp báo cáo');
    return 2;
  }
  return run(
    {
      sha,
      repo: flag('--repo') ?? env.GITHUB_REPOSITORY ?? 'nguyennam140401/Hatchly',
      buildUrl: flag('--build-url') ?? '(không rõ)',
      files,
      dryRun: argv.includes('--dry-run'),
    },
    env,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
