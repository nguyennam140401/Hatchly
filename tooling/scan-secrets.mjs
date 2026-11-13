// pnpm check:secrets – quét bí mật trong mã nguồn và nhật ký mẫu (hiến pháp, cổng CI số 5; 004
// contracts/auth-ops.md mục 5). Bản tối thiểu: chỉ bắt GIÁ TRỊ thật (mã phiên đủ dài, băm argon2id đầy
// đủ, khóa riêng, khóa truy cập AWS) – không bắt tên cookie hay tiền tố đứng một mình trong mã/kiểm thử.
// Dùng: node tooling/scan-secrets.mjs [tệp hoặc thư mục…]   (mặc định: tệp git theo dõi + tệp mới chưa ignore)
// 008: phạm vi mặc định gồm cả định nghĩa quy trình (ops/**, infra/ci/**, Jenkinsfile*, .github/**) dù tệp
// không có đuôi quen thuộc; tham số nhận cả TỆP ĐƠN (vd nhật ký một lần chạy triển khai –
// contracts/deploy-pipeline.md mục 9). Chỉ báo tệp + dòng + loại – KHÔNG BAO GIỜ in giá trị.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export const SECRET_PATTERNS = [
  { name: 'cookie phiên khách hàng', re: /__Host-sid=[A-Za-z0-9_-]{20,}/ },
  { name: 'cookie phiên nhân viên', re: /__Host-staff_sid=[A-Za-z0-9_-]{20,}/ },
  {
    name: 'băm mật khẩu argon2id',
    re: /\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]{8,}\$[A-Za-z0-9+/]{16,}/,
  },
  { name: 'khóa riêng', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'khóa truy cập AWS', re: /\bAKIA[0-9A-Z]{16}\b/ },
  // 008: thông tin triển khai của quy trình (GitHub App / mã cá nhân, bot Telegram).
  {
    name: 'mã truy cập GitHub',
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/,
  },
  { name: 'mã bot Telegram', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/ },
  // 005 (SC-009): chuỗi mồi của bộ kiểm thử hợp đồng – CHỈ quét trong nhật ký (.ndjson/.log), vì mã
  // kiểm thử cố ý chứa chúng. Thấy trong nhật ký = mã quyền / lời nhắc / nội dung bài bị ghi ra.
  { name: 'mã quyền giả lọt nhật ký', re: /fake_tok_[A-Za-z0-9_-]{4,}/, logsOnly: true },
  { name: 'lời nhắc AI lọt nhật ký', re: /PROMPT_CANARY_[A-Za-z0-9_]+/, logsOnly: true },
  { name: 'nội dung bài lọt nhật ký', re: /POST_CANARY_[A-Za-z0-9_]+/, logsOnly: true },
];

/** Tệp nhật ký (chịu thêm mẫu `logsOnly`). */
const LOG_EXT = new Set(['.log', '.ndjson']);

const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.sql',
  '.yml',
  '.yaml',
  '.env',
  '.example',
  '.log',
  '.ndjson',
  '.txt',
  '.html',
  '.css',
  '.sh',
  '.groovy',
  '.tf',
  '.tfvars',
  '.hcl',
  '.conf',
  '.nft',
  '.service',
  '.tpl',
  '.toml',
  '.xml',
  '.properties',
]);
/** Đường dẫn thuộc định nghĩa quy trình (008): quét MỌI tệp văn bản, không xét đuôi. */
const PIPELINE_PATHS = [
  /^ops\//,
  /^infra\/ci\//,
  /^\.github\//,
  /(^|\/)Jenkinsfile[^/]*$/,
  /(^|\/)Dockerfile[^/]*$/,
];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'dist-types']);
// Bộ mẫu vi phạm của chính công cụ này.
const ALLOW = [/^tooling\/test\/fixtures\/secrets\//];

function walk(target, out = []) {
  // Thư mục chưa có (vd test-logs khi chưa chạy kiểm thử) → không có tệp.
  if (!existsSync(target)) return out;
  // Tham số là một tệp đơn (vd nhật ký của một lần chạy).
  if (statSync(target).isFile()) {
    out.push(target);
    return out;
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(target, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function gitFiles() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' });
  return out.split('\n').filter((f) => f !== '');
}

/**
 * Các phát hiện `{ file, line, name }` trong danh sách tệp.
 * `explicit`: tệp do người gọi nêu đích danh (tham số dòng lệnh) → quét dù đuôi tệp lạ, coi như nhật ký.
 */
export function scanFiles(files, root = process.cwd(), { explicit = false } = {}) {
  const findings = [];
  for (const file of files) {
    const rel = relative(root, file).replaceAll('\\', '/');
    if (ALLOW.some((re) => re.test(rel))) continue;
    const ext = extname(file) || file.slice(file.lastIndexOf('/') + 1);
    const inPipeline = PIPELINE_PATHS.some((re) => re.test(rel));
    const known = TEXT_EXT.has(ext) || rel.endsWith('.env.example');
    if (!explicit && !inPipeline && !known) continue;
    let text;
    try {
      // Nhật ký một lần chạy có thể dài – tệp nêu đích danh được phép tới 50 MB.
      if (statSync(file).size > (explicit ? 50_000_000 : 2_000_000)) continue;
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // Tệp nhị phân (ảnh, tệp nén) nằm trong thư mục quy trình → bỏ qua.
    if (!known && text.includes(String.fromCharCode(0))) continue;
    const isLog = LOG_EXT.has(extname(file)) || (explicit && !known);
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const p of SECRET_PATTERNS) {
        if (p.logsOnly === true && !isLog) continue;
        if (p.re.test(line)) findings.push({ file: rel, line: i + 1, name: p.name });
      }
    });
  }
  return findings;
}

// Chạy như lệnh (không chạy khi được nhập từ kiểm thử).
if (process.argv[1]?.replaceAll('\\', '/').endsWith('tooling/scan-secrets.mjs')) {
  const targets = process.argv.slice(2);
  const files = targets.length > 0 ? targets.flatMap((t) => walk(t)) : gitFiles();
  const findings = scanFiles(files, process.cwd(), { explicit: targets.length > 0 });
  for (const f of findings) console.error(`✖ ${f.file}:${f.line} – ${f.name}`);
  if (findings.length > 0) {
    console.error(`✖ ${findings.length} bí mật bị phát hiện`);
    process.exit(1);
  }
  console.log(`✔ không thấy bí mật (${files.length} tệp)`);
}
