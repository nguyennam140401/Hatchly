// pnpm check:secrets – quét bí mật trong mã nguồn và nhật ký mẫu (hiến pháp, cổng CI số 5; 004
// contracts/auth-ops.md mục 5). Bản tối thiểu: chỉ bắt GIÁ TRỊ thật (mã phiên đủ dài, băm argon2id đầy
// đủ, khóa riêng, khóa truy cập AWS) – không bắt tên cookie hay tiền tố đứng một mình trong mã/kiểm thử.
// Dùng: node tooling/scan-secrets.mjs [thư mục…]   (mặc định: tệp git theo dõi + tệp mới chưa ignore)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const INFRA_SCOPE = /^(?:infra\/|\.github\/workflows\/)/;

export const SECRET_PATTERNS = [
  { name: 'cookie phiên khách hàng', re: /__Host-sid=[A-Za-z0-9_-]{20,}/ },
  { name: 'cookie phiên nhân viên', re: /__Host-staff_sid=[A-Za-z0-9_-]{20,}/ },
  {
    name: 'băm mật khẩu argon2id',
    re: /\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]{8,}\$[A-Za-z0-9+/]{16,}/,
  },
  { name: 'khóa riêng', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'khóa truy cập AWS', re: /\bAKIA[0-9A-Z]{16}\b/ },
  // 005 (SC-009): chuỗi mồi của bộ kiểm thử hợp đồng – CHỈ quét trong nhật ký (.ndjson/.log), vì mã
  // kiểm thử cố ý chứa chúng. Thấy trong nhật ký = mã quyền / lời nhắc / nội dung bài bị ghi ra.
  { name: 'mã quyền giả lọt nhật ký', re: /fake_tok_[A-Za-z0-9_-]{4,}/, logsOnly: true },
  { name: 'lời nhắc AI lọt nhật ký', re: /PROMPT_CANARY_[A-Za-z0-9_]+/, logsOnly: true },
  { name: 'nội dung bài lọt nhật ký', re: /POST_CANARY_[A-Za-z0-9_]+/, logsOnly: true },
  // 007 (hạ tầng): chỉ quét trong `infra/` và `.github/workflows/` (tài liệu/kiểm thử nơi khác có thể
  // nêu tên khóa làm ví dụ). Giá trị rỗng, biến (`var.x`, `${…}`) hay chỗ giữ `<…>` không bị bắt.
  {
    name: 'khóa truy cập/bí mật S3 gán cứng',
    re: /\b(?:access_key|secret_key)\s*=\s*"[^"$<]{4,}"/,
    onlyIn: INFRA_SCOPE,
  },
  {
    name: 'AWS_SECRET_ACCESS_KEY có giá trị',
    re: /AWS_SECRET_ACCESS_KEY\s*[=:]\s*[^\s"'$<{]{4,}/,
    onlyIn: INFRA_SCOPE,
  },
  {
    name: 'bí mật tài khoản dịch vụ VNG gán cứng',
    re: /\bclient_secret\s*=\s*"[^"$<]{4,}"/,
    onlyIn: INFRA_SCOPE,
  },
  {
    name: 'chuỗi kết nối có mật khẩu',
    re: /postgres(?:ql)?:\/\/[^\s:@/$<{]+:[^\s@/$<{]+@/,
    onlyIn: INFRA_SCOPE,
  },
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
  '.tf',
  '.tfvars',
  '.hcl',
]);
// `.terraform` (nhị phân provider), `.plans` (bản xem trước đã lưu): không phải mã nguồn.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  'dist-types',
  '.terraform',
  '.plans',
]);
// Bộ mẫu vi phạm của chính công cụ này; hồ sơ chứng thực cục bộ của `pnpm infra` (bị gitignore, chỉ
// `.env.example` rỗng giá trị mới được quét).
const ALLOW = [
  /^tooling\/test\/fixtures\/secrets\//,
  /^tooling\/test\/fixtures\/secrets-infra\//,
  /^infra\/\.credentials\/(?!\.env\.example$)/,
];

function walk(dir, out = []) {
  // Thư mục chưa có (vd test-logs khi chưa chạy kiểm thử) → không có tệp.
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function gitFiles() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' });
  return out.split('\n').filter((f) => f !== '');
}

/** Các phát hiện `{ file, line, name }` trong danh sách tệp. */
export function scanFiles(files, root = process.cwd()) {
  const findings = [];
  for (const file of files) {
    const rel = relative(root, file).replaceAll('\\', '/');
    if (ALLOW.some((re) => re.test(rel))) continue;
    const ext = extname(file) || file.slice(file.lastIndexOf('/') + 1);
    if (!TEXT_EXT.has(ext) && !rel.endsWith('.env.example')) continue;
    let text;
    try {
      if (statSync(file).size > 2_000_000) continue;
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const isLog = LOG_EXT.has(extname(file));
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const p of SECRET_PATTERNS) {
        if (p.logsOnly === true && !isLog) continue;
        if (p.onlyIn !== undefined && !p.onlyIn.test(rel)) continue;
        if (p.re.test(line)) findings.push({ file: rel, line: i + 1, name: p.name });
      }
    });
  }
  return findings;
}

// Chạy như lệnh (không chạy khi được nhập từ kiểm thử).
if (process.argv[1]?.replaceAll('\\', '/').endsWith('tooling/scan-secrets.mjs')) {
  const dirs = process.argv.slice(2);
  const files = dirs.length > 0 ? dirs.flatMap((d) => walk(d)) : gitFiles();
  const findings = scanFiles(files);
  for (const f of findings) console.error(`✖ ${f.file}:${f.line} – ${f.name}`);
  if (findings.length > 0) {
    console.error(`✖ ${findings.length} bí mật bị phát hiện`);
    process.exit(1);
  }
  console.log(`✔ không thấy bí mật (${files.length} tệp)`);
}
