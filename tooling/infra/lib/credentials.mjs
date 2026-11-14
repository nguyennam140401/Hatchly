// Hồ sơ chứng thực của `pnpm infra` (T019, contracts/infra-cli.md mục 1). Không bao giờ in giá trị.
import { existsSync, readFileSync } from 'node:fs';
import { CliExit, EXIT } from './exit-codes.mjs';
import { credentialsFile, envFile } from './paths.mjs';
import { parseTfvars } from './params-diff.mjs';

export const REQUIRED_VARS = [
  'VNGCLOUD_CLIENT_ID',
  'VNGCLOUD_CLIENT_SECRET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
];

/** `KHÓA=giá trị` mỗi dòng; bỏ dòng trống và dòng bắt đầu bằng `#`. Bỏ cặp nháy bao ngoài. */
export function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

/**
 * Trả bộ biến để truyền cho tiến trình con (không sửa `process.env` của chính CLI).
 * `CI=true` → đọc thẳng từ biến môi trường, không cần tệp. Thiếu → ném `CliExit` mã 4 nêu TÊN biến thiếu.
 * @param {string} env
 * @param {{ environ?: Record<string,string|undefined>, readFile?: (p: string) => string|null }} [deps]
 */
export function loadCredentials(env, deps = {}) {
  const environ = deps.environ ?? process.env;
  let values;
  if (environ.CI === 'true') {
    values = Object.fromEntries(REQUIRED_VARS.map((name) => [name, environ[name]]));
  } else {
    const path = credentialsFile(env);
    const text = deps.readFile
      ? deps.readFile(path)
      : existsSync(path)
        ? readFileSync(path, 'utf8')
        : null;
    if (text === null) {
      throw new CliExit(
        `Thiếu hồ sơ chứng thực ${path}. Chép infra/.credentials/.env.example thành infra/.credentials/${env}.env rồi điền.`,
        EXIT.NOT_READY,
      );
    }
    values = parseEnvFile(text);
  }
  const missing = REQUIRED_VARS.filter((name) => values[name] === undefined || values[name] === '');
  if (missing.length > 0) {
    throw new CliExit(
      `Hồ sơ chứng thực thiếu biến: ${missing.join(', ')}. Mẫu: infra/.credentials/.env.example.`,
      EXIT.NOT_READY,
    );
  }
  return Object.fromEntries(REQUIRED_VARS.map((name) => [name, values[name]]));
}

/** `project_id` khai trong `infra/envs/<env>.tfvars`. */
export function projectIdOf(env) {
  const vars = parseTfvars(readFileSync(envFile(env, 'tfvars'), 'utf8'));
  return vars.project_id;
}

/**
 * Hồ sơ vừa nạp phải thuộc đúng môi trường: liệt kê project mà tài khoản dịch vụ thấy được và so với
 * `project_id` của tệp tham số. Lệch → thoát 3 "Hồ sơ chứng thực không thuộc môi trường <env>".
 *
 * ⏳ P6: điểm cuối API cần xác minh khi có tài khoản VNG Cloud thật; `listProjectIds` tiêm được để kiểm thử.
 * Không gọi được API → thoát 4 (không xác minh được thì không cho chạy lệnh ghi).
 */
export async function assertCredentialsMatchEnv(
  env,
  creds,
  { listProjectIds = defaultListProjectIds, projectId } = {},
) {
  const expected = projectId ?? projectIdOf(env);
  let seen;
  try {
    seen = await listProjectIds(creds);
  } catch {
    throw new CliExit(
      `Không xác minh được hồ sơ chứng thực thuộc môi trường ${env} (không gọi được API liệt kê project). Kiểm tra mạng và hồ sơ.`,
      EXIT.NOT_READY,
    );
  }
  if (!seen.includes(expected)) {
    throw new CliExit(`Hồ sơ chứng thực không thuộc môi trường ${env}.`, EXIT.BLOCKED);
  }
}

const IAM_TOKEN_URL = 'https://iamapis.vngcloud.vn/accounts-api/v2/auth/token';
const VSERVER_PROJECTS_URL = 'https://vserver.api.vngcloud.vn/vserver/vserver-gateway/v1/projects';

/** Mặc định: đổi (client_id, client_secret) lấy token IAM rồi liệt kê project của vServer. ⏳ P6: xác minh. */
export async function defaultListProjectIds(creds) {
  const basic = Buffer.from(`${creds.VNGCLOUD_CLIENT_ID}:${creds.VNGCLOUD_CLIENT_SECRET}`).toString(
    'base64',
  );
  const tokenResponse = await fetch(IAM_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials' }),
  });
  if (!tokenResponse.ok) throw new Error(`IAM ${tokenResponse.status}`);
  const { access_token: token } = await tokenResponse.json();
  const response = await fetch(VSERVER_PROJECTS_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`vServer ${response.status}`);
  const body = await response.json();
  const items = body.listData ?? body.data ?? body.projects ?? [];
  return items.map((p) => p.projectId ?? p.id).filter((id) => typeof id === 'string');
}
