// pnpm check:pipeline – kiểm chính định nghĩa của quy trình tích hợp – triển khai (008, R19).
// Dùng: node tooling/check-pipeline.mjs [--ci]     (CI=true tương đương --ci)
// Kiểm:
//   1. mọi ảnh nền (`FROM` trong Dockerfile, `image:` trong ops/**/*.yml) cố định theo digest `@sha256:`
//   2. ops/ci/jenkins/plugins.txt: mỗi dòng `<tên>:<phiên bản>`, không `latest`
//   3. ops/ci/versions.env: đủ phiên bản + mã băm
//   4. ops/deploy/env/{staging,production}.yaml đúng schema.json, `name` khớp tên tệp
//   5. mỗi bước của DEFAULT_STEPS thuộc đúng một làn trong ops/ci/gate-lanes.json
//   6. ops/ci/github/rulesets/*.json hợp lệ, có kiểm tra bắt buộc `ci/gates`, khớp số thành viên (FR-004)
//   7. helm lint + helm template với cả hai bộ tham số (khi có chart; thiếu helm: --ci là không đạt)
//   8. apps/server có kịch bản `test:compat` (hợp đồng db:compat)
//   9. ngoại lệ trong ops/ci/exceptions/ hợp lệ (hết hạn → nhắc xóa, không làm đỏ)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { loadExceptions } from './lib/gate-exceptions.mjs';
import { validate } from './lib/mini-json-schema.mjs';

const ENV_NAMES = ['staging', 'production'];
const REQUIRED_VERSION_KEYS = ['HELM', 'KUBECTL', 'TRIVY'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.terraform']);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const readLines = (file) => readFileSync(file, 'utf8').split(/\r?\n/);

/** Chạy `helm`; trả `{ missing }` khi máy không có lệnh. */
function defaultHelm(args) {
  const result = spawnSync('helm', args, { encoding: 'utf8' });
  if (result.error) return { missing: true, status: 1, output: '' };
  return { missing: false, status: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}

/**
 * @param {{ root?: string, ci?: boolean, steps: { name: string }[], helm?: typeof defaultHelm, now?: Date }} options
 * @returns {{ errors: { file: string, line?: number, message: string }[], warnings: string[], notes: string[] }}
 */
export function checkPipeline({ root = '.', ci = false, steps, helm = defaultHelm, now }) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const at = (...parts) => join(root, ...parts);
  const rel = (file) => relative(root, file).replaceAll('\\', '/');
  const fail = (file, message, line) => errors.push({ file: rel(file), line, message });

  // ---- 1. Ảnh cố định theo digest ----
  const dockerfiles = [
    at('Dockerfile'),
    ...walk(at('ops', 'ci')).filter((f) => basename(f).startsWith('Dockerfile')),
  ].filter((f) => existsSync(f));
  for (const file of dockerfiles) {
    const stages = new Set();
    readLines(file).forEach((text, i) => {
      const match = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(text);
      if (!match) return;
      const [, image, alias] = match;
      // `FROM <tầng trước>` và `scratch` không phải ảnh kéo về.
      if (!stages.has(image.toLowerCase()) && image !== 'scratch' && !image.includes('@sha256:')) {
        fail(file, `ảnh nền "${image}" chưa cố định theo digest (@sha256:…)`, i + 1);
      }
      if (alias) stages.add(alias.toLowerCase());
    });
  }
  const yamlFiles = walk(at('ops')).filter((f) => /\.ya?ml$/.test(f));
  for (const file of yamlFiles) {
    readLines(file).forEach((text, i) => {
      const match = /^\s*(?:-\s+)?image:\s*(.*)$/.exec(text);
      if (!match) return;
      const value = match[1]
        .replace(/\s+#.*$/, '')
        .replace(/^["']|["']$/g, '')
        .trim();
      // `image:` mở đầu một khối (vd values.yaml: image: { repository, digest }) → không phải tham chiếu.
      if (value === '' || (value.startsWith('{') && !value.startsWith('{{'))) return;
      // Mẫu Helm: giá trị ghép từ tham số → phải ghép theo digest.
      // Biến thay lúc triển khai (`${IMAGE_REF}` của migrate-job.yaml): release-image.mjs luôn trả `repo@sha256:…`.
      if (/^\$\{[A-Z_]+\}$/.test(value)) return;
      const pinned = value.includes('{{')
        ? /@\s*\{\{|digest/i.test(value)
        : value.includes('@sha256:');
      if (!pinned) fail(file, `ảnh "${value}" chưa cố định theo digest (@sha256:…)`, i + 1);
    });
  }

  // ---- 2. Phần mở rộng Jenkins cố định phiên bản ----
  const plugins = at('ops', 'ci', 'jenkins', 'plugins.txt');
  if (existsSync(plugins)) {
    readLines(plugins).forEach((text, i) => {
      const line = text.replace(/#.*$/, '').trim();
      if (line === '') return;
      const match = /^([A-Za-z0-9._-]+):(\S+)$/.exec(line);
      if (!match) fail(plugins, `"${line}" phải có dạng <tên>:<phiên bản>`, i + 1);
      else if (match[2] === 'latest')
        fail(plugins, `"${match[1]}" dùng latest – ghi phiên bản cụ thể`, i + 1);
    });
  }

  // ---- 3. Phiên bản công cụ ----
  const versions = at('ops', 'ci', 'versions.env');
  if (!existsSync(versions)) fail(versions, 'thiếu tệp phiên bản công cụ');
  else {
    const values = new Map();
    readLines(versions).forEach((text, i) => {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(text.trim());
      if (match) values.set(match[1], { value: match[2], line: i + 1 });
    });
    for (const tool of REQUIRED_VERSION_KEYS) {
      const version = values.get(`${tool}_VERSION`);
      const sha = values.get(`${tool}_SHA256_LINUX_AMD64`);
      if (!version || version.value === '' || version.value === 'latest') {
        fail(versions, `${tool}_VERSION: thiếu hoặc không phải phiên bản cụ thể`, version?.line);
      }
      if (!sha || !/^[0-9a-f]{64}$/.test(sha.value)) {
        fail(
          versions,
          `${tool}_SHA256_LINUX_AMD64: thiếu hoặc không phải mã băm SHA-256`,
          sha?.line,
        );
      }
    }
    const postgres = values.get('TEST_POSTGRES_IMAGE');
    if (!postgres || !/@sha256:[0-9a-f]{64}$/.test(postgres.value)) {
      fail(versions, 'TEST_POSTGRES_IMAGE: thiếu hoặc chưa cố định theo digest', postgres?.line);
    }
  }

  // ---- 4. Tham số môi trường ----
  const schemaFile = at('ops', 'deploy', 'env', 'schema.json');
  const envParams = {};
  if (!existsSync(schemaFile)) fail(schemaFile, 'thiếu lược đồ tham số môi trường');
  else {
    const schema = JSON.parse(readFileSync(schemaFile, 'utf8'));
    for (const name of ENV_NAMES) {
      const file = at('ops', 'deploy', 'env', `${name}.yaml`);
      if (!existsSync(file)) {
        fail(file, 'thiếu tệp tham số môi trường');
        continue;
      }
      let data;
      try {
        data = parse(readFileSync(file, 'utf8'));
      } catch (err) {
        fail(
          file,
          `YAML không hợp lệ: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
        );
        continue;
      }
      const problems = validate(data, schema);
      for (const problem of problems) fail(file, problem);
      if (data?.name !== name && !problems.some((p) => p.startsWith('name:'))) {
        fail(file, `name: "${String(data?.name)}" không khớp tên tệp (${name})`);
      }
      if (problems.length === 0) envParams[name] = data;
    }
  }

  // ---- 5. Làn ----
  const lanesFile = at('ops', 'ci', 'gate-lanes.json');
  if (!existsSync(lanesFile)) fail(lanesFile, 'thiếu tệp gán làn');
  else {
    const lanes = JSON.parse(readFileSync(lanesFile, 'utf8')).lanes ?? {};
    const stepNames = steps.map((s) => s.name);
    const seen = new Map();
    for (const [lane, items] of Object.entries(lanes)) {
      for (const item of items) {
        if (!stepNames.includes(item.step)) {
          fail(lanesFile, `làn "${lane}" nêu bước không tồn tại: ${item.step}`);
        }
        if (!Number.isFinite(item.order))
          fail(lanesFile, `làn "${lane}": bước ${item.step} thiếu order`);
        seen.set(item.step, [...(seen.get(item.step) ?? []), lane]);
      }
    }
    for (const name of stepNames) {
      const inLanes = seen.get(name) ?? [];
      if (inLanes.length === 0) fail(lanesFile, `bước "${name}" không thuộc làn nào`);
      else if (inLanes.length > 1)
        fail(lanesFile, `bước "${name}" thuộc nhiều làn: ${inLanes.join(', ')}`);
    }
  }

  // ---- 6. Luật bảo vệ nhánh ----
  const rulesetDir = at('ops', 'ci', 'github', 'rulesets');
  const teamFile = at('ops', 'ci', 'team.json');
  const memberCount = existsSync(teamFile)
    ? (JSON.parse(readFileSync(teamFile, 'utf8')).members ?? []).length
    : 0;
  for (const file of walk(rulesetDir).filter((f) => f.endsWith('.json'))) {
    let ruleset;
    try {
      ruleset = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      fail(file, `JSON không hợp lệ: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const rules = Array.isArray(ruleset.rules) ? ruleset.rules : [];
    const checks = rules
      .filter((r) => r.type === 'required_status_checks')
      .flatMap((r) => r.parameters?.required_status_checks ?? [])
      .map((c) => c.context);
    if (!checks.includes('ci/gates')) fail(file, 'thiếu kiểm tra bắt buộc "ci/gates"');
    // FR-004: từ hai thành viên trở lên thì phải có người duyệt khác tác giả.
    const pullRequest = rules.find((r) => r.type === 'pull_request');
    if (!pullRequest) fail(file, 'thiếu luật "pull_request" (không đẩy thẳng lên nhánh)');
    else if (
      memberCount >= 2 &&
      !((pullRequest.parameters?.required_approving_review_count ?? 0) >= 1)
    ) {
      fail(
        file,
        `ops/ci/team.json có ${memberCount} thành viên nhưng luật chưa yêu cầu người duyệt ` +
          '(required_approving_review_count ≥ 1) – FR-004',
      );
    }
  }

  // ---- 7. Helm ----
  const chart = at('ops', 'deploy', 'chart');
  if (existsSync(join(chart, 'Chart.yaml'))) {
    const lint = helm(['lint', chart]);
    if (lint.missing) {
      if (ci)
        fail(
          join(chart, 'Chart.yaml'),
          'không có lệnh helm – trên CI không được bỏ qua kiểm chart',
        );
      else notes.push('bỏ qua helm lint/template: máy này chưa cài helm (trên CI là bắt buộc)');
    } else {
      if (lint.status !== 0)
        fail(join(chart, 'Chart.yaml'), `helm lint không đạt: ${lastLine(lint.output)}`);
      for (const name of ENV_NAMES) {
        const values = join(chart, 'ci', `${name}-values.yaml`);
        const args = ['template', 'app', chart, ...(existsSync(values) ? ['-f', values] : [])];
        const rendered = helm(args);
        if (rendered.status !== 0) {
          fail(
            join(chart, 'Chart.yaml'),
            `helm template (${name}) không đạt: ${lastLine(rendered.output)}`,
          );
        }
      }
    }
  }

  // ---- 8. Hợp đồng test:compat ----
  const serverPackage = at('apps', 'server', 'package.json');
  if (existsSync(serverPackage)) {
    const scripts = JSON.parse(readFileSync(serverPackage, 'utf8')).scripts ?? {};
    if (!scripts['test:compat']) {
      fail(
        serverPackage,
        'thiếu kịch bản "test:compat" (hợp đồng của db:compat – quality-gates.md mục 7)',
      );
    }
  }

  // ---- 9. Ngoại lệ ----
  const exceptionsDir = at('ops', 'ci', 'exceptions');
  if (existsSync(exceptionsDir) && statSync(exceptionsDir).isDirectory()) {
    const exceptions = loadExceptions({
      dir: exceptionsDir,
      teamFile,
      gateNames: steps.map((s) => s.name),
      now,
    });
    for (const item of exceptions) {
      for (const problem of item.errors) fail(item.file, problem);
      if (item.errors.length === 0 && item.expired) {
        warnings.push(`${rel(item.file)}: ngoại lệ đã hết hạn – xóa tệp này`);
      }
    }
  }

  // ---- 10. Mẫu Kubernetes không chứa Secret (FR-039): bí mật chỉ nằm trong cụm, không trong kho ----
  const templateFiles = [
    ...walk(at('ops', 'deploy', 'chart', 'templates')),
    at('ops', 'deploy', 'migrate-job.yaml'),
  ].filter((f) => existsSync(f));
  for (const file of templateFiles) {
    readLines(file).forEach((text, i) => {
      if (/^\s*kind:\s*Secret\b/.test(text)) {
        fail(
          file,
          'mẫu Kubernetes không được định nghĩa `kind: Secret` – bí mật chỉ nằm trong cụm',
          i + 1,
        );
      }
    });
  }

  // ---- 11. .trivyignore: mỗi mục kèm lý do + ngày hết hạn còn hiệu lực (008 FR-029, T083) ----
  const trivyIgnore = at('.trivyignore');
  if (existsSync(trivyIgnore)) {
    const today = (now ?? new Date()).toISOString().slice(0, 10);
    const lines = readLines(trivyIgnore);
    lines.forEach((text, i) => {
      const entry = text.trim();
      if (entry === '' || entry.startsWith('#')) return;
      // Khối chú thích liền ngay trên mục (các dòng `#` liên tiếp).
      const block = [];
      for (let j = i - 1; j >= 0 && lines[j].trim().startsWith('#'); j--)
        block.unshift(lines[j].trim());
      const note = block.join(' | ');
      const reason = /#\s*lý do:\s*\S.{9,}/i.test(note);
      const expiry = /(?:expires|hết hạn):\s*(\d{4}-\d{2}-\d{2})/i.exec(note)?.[1];
      if (!reason || !expiry) {
        fail(
          trivyIgnore,
          `"${entry}" thiếu dòng chú thích ngay trên: "# lý do: … " rồi "# expires: YYYY-MM-DD"`,
          i + 1,
        );
      } else if (expiry < today) {
        fail(
          trivyIgnore,
          `"${entry}" đã hết hạn ${expiry} – xử lý lỗ hổng hoặc gia hạn kèm lý do mới`,
          i + 1,
        );
      }
    });
  }

  // ---- 12. Jenkinsfile.ci khớp gate-lanes.json; job được nạp đều có tệp (008 R9) ----
  const jenkinsfileCi = at('ops', 'ci', 'Jenkinsfile.ci');
  if (existsSync(jenkinsfileCi) && existsSync(lanesFile)) {
    const used = new Set(
      [...readFileSync(jenkinsfileCi, 'utf8').matchAll(/run-lane\.sh\s+(\w+)/g)].map((m) => m[1]),
    );
    const lanes = new Set(Object.keys(JSON.parse(readFileSync(lanesFile, 'utf8')).lanes ?? {}));
    for (const lane of lanes) {
      if (!used.has(lane)) fail(jenkinsfileCi, `làn "${lane}" của gate-lanes.json không được chạy`);
    }
    for (const lane of used) {
      if (!lanes.has(lane))
        fail(jenkinsfileCi, `Jenkinsfile.ci chạy làn "${lane}" không có trong gate-lanes.json`);
    }
  }
  const jobsYaml = at('ops', 'ci', 'jenkins', 'casc', 'jobs.yaml');
  if (existsSync(jobsYaml)) {
    for (const m of readFileSync(jobsYaml, 'utf8').matchAll(
      /\/var\/jenkins_jobs\/(\S+\.groovy)/g,
    )) {
      if (!existsSync(at('ops', 'ci', 'jenkins', 'jobs', m[1]))) {
        fail(jobsYaml, `tham chiếu ${m[1]} nhưng không có tệp ops/ci/jenkins/jobs/${m[1]}`);
      }
    }
  }

  return { errors, warnings, notes };
}

function lastLine(output) {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return lines.find((l) => /error/i.test(l)) ?? lines.at(-1) ?? '';
}

// Chạy như lệnh (không chạy khi được nhập từ kiểm thử).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { DEFAULT_STEPS } = await import('./verify.mjs');
  const ci = process.argv.includes('--ci') || process.env.CI === 'true';
  const { errors, warnings, notes } = checkPipeline({ ci, steps: DEFAULT_STEPS });
  for (const note of notes) console.log(`· ${note}`);
  for (const warning of warnings) console.warn(`! ${warning}`);
  for (const e of errors) console.error(`✖ ${e.file}${e.line ? `:${e.line}` : ''} – ${e.message}`);
  if (errors.length > 0) {
    console.error(`✖ ${errors.length} lỗi trong định nghĩa quy trình`);
    process.exit(1);
  }
  console.log('✔ định nghĩa quy trình hợp lệ');
}
