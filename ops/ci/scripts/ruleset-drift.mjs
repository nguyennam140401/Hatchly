// So luật bảo vệ nhánh đang áp trên GitHub với hai tệp trong kho (008 R7, FR-003/FR-004).
// Dùng: node ruleset-drift.mjs [--diff-only] [--dir ops/ci/github/rulesets] [--repo <chủ>/<kho>]
//   --diff-only: chỉ in khác biệt, không báo Telegram (apply-rulesets.sh dùng để cho xem trước khi áp).
// Biến môi trường: GITHUB_TOKEN (mã cài đặt của GitHub App "ci": Administration chỉ đọc), tùy chọn
// GITHUB_REPOSITORY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. Mã thoát: 0 = khớp; 1 = lệch; 2 = lỗi gọi GitHub.
// Chỉ so các trường do kho quản lý (tên, đích, hiệu lực, điều kiện, người vượt luật, luật + tham số); bỏ qua id,
// thời gian, liên kết. `integration_id` của kiểm tra bắt buộc do GitHub điền – không so.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sendTelegram } from './notify-telegram.mjs';

const API = 'https://api.github.com';

/** Hình chuẩn để so: sắp xếp khóa, bỏ trường do GitHub điền. */
export function normalize(ruleset) {
  const rules = (ruleset.rules ?? [])
    .map((rule) => {
      const parameters = rule.parameters === undefined ? undefined : { ...rule.parameters };
      if (parameters?.required_status_checks) {
        parameters.required_status_checks = parameters.required_status_checks
          .map((c) => ({ context: c.context }))
          .sort((a, b) => a.context.localeCompare(b.context));
      }
      if (parameters?.allowed_merge_methods) {
        parameters.allowed_merge_methods = [...parameters.allowed_merge_methods].sort();
      }
      return { type: rule.type, ...(parameters === undefined ? {} : { parameters }) };
    })
    .sort((a, b) => a.type.localeCompare(b.type));
  return {
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    conditions: ruleset.conditions ?? {},
    bypass_actors: ruleset.bypass_actors ?? [],
    rules,
  };
}

/** Danh sách đường dẫn trường lệch giữa hai giá trị đã chuẩn hóa. */
export function diffPaths(expected, actual, path = '') {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
  const bothObjects =
    expected !== null &&
    actual !== null &&
    typeof expected === 'object' &&
    typeof actual === 'object' &&
    Array.isArray(expected) === Array.isArray(actual);
  if (!bothObjects) return [path === '' ? '(gốc)' : path];
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const out = [];
  for (const key of [...keys].sort()) {
    const next = path === '' ? key : `${path}.${key}`;
    out.push(...diffPaths(expected[key], actual[key], next));
  }
  return out;
}

async function github(path, env, fetchFn = fetch) {
  const res = await fetchFn(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub trả HTTP ${res.status} cho ${path}`);
  return res.json();
}

/**
 * @returns {Promise<{name: string, status: 'ok'|'drift'|'missing', fields: string[]}[]>}
 */
export async function compare({ dir, repo, env, fetchFn = fetch }) {
  const local = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const listed = await github(`/repos/${repo}/rulesets?per_page=100`, env, fetchFn);
  const results = [];
  for (const want of local) {
    const found = listed.find((r) => r.name === want.name);
    if (!found) {
      results.push({ name: want.name, status: 'missing', fields: [] });
      continue;
    }
    const actual = await github(`/repos/${repo}/rulesets/${found.id}`, env, fetchFn);
    const fields = diffPaths(normalize(want), normalize(actual));
    results.push({ name: want.name, status: fields.length === 0 ? 'ok' : 'drift', fields });
  }
  return results;
}

export function report(results) {
  return results
    .map((r) =>
      r.status === 'ok'
        ? `✔ ${r.name}: khớp`
        : r.status === 'missing'
          ? `✖ ${r.name}: CHƯA được áp trên GitHub`
          : `✖ ${r.name}: lệch ở ${r.fields.join(', ')}`,
    )
    .join('\n');
}

async function main(argv, env) {
  const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : (argv[i + 1] ?? fallback);
  };
  const dir = flag('--dir', 'ops/ci/github/rulesets');
  const repo = flag('--repo', env.GITHUB_REPOSITORY ?? 'nguyennam140401/Hatchly');
  if (!env.GITHUB_TOKEN) {
    console.error('✖ thiếu GITHUB_TOKEN');
    return 2;
  }
  let results;
  try {
    results = await compare({ dir, repo, env });
  } catch (err) {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const text = report(results);
  console.log(text);
  const drifted = results.some((r) => r.status !== 'ok');
  if (drifted && !argv.includes('--diff-only')) {
    await sendTelegram(
      `🚨 ƯU TIÊN CAO
Luật bảo vệ nhánh trên GitHub LỆCH so với kho:
${text}
Áp lại: ops/ci/github/apply-rulesets.sh`,
      env,
    ).catch(() => undefined);
  }
  return drifted ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
