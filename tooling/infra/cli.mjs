// Điểm vào `pnpm infra <lệnh> [<env>] [tùy chọn]` (contracts/infra-cli.md).
// Mỗi lệnh nằm ở tooling/infra/commands/<lệnh>.mjs và xuất hàm `run({ env, args, flags })` trả mã thoát.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { CliExit, EXIT } from './lib/exit-codes.mjs';

export const ENVIRONMENTS = ['staging', 'production'];

/**
 * Danh sách lệnh (19 dòng của contracts/infra-cli.md mục 2; `secrets` và `drill` gộp lệnh con).
 * `env`: 'required' = tham số đầu bắt buộc là môi trường; 'none' = không nhận môi trường;
 * 'sub' = lệnh con đứng trước, môi trường là `--from`/tham số tiếp theo do lệnh tự kiểm.
 */
export const COMMANDS = {
  check: {
    env: 'none',
    usage: 'check',
    help: 'Kiểm tra tĩnh (fmt, validate, tflint, terraform test, tham số, bí mật, Vitest)',
  },
  'bootstrap-check': {
    env: 'required',
    usage: 'bootstrap-check <env> [--mark <mục>]',
    help: 'Kiểm danh sách khởi tạo một lần',
  },
  plan: {
    env: 'required',
    usage: 'plan <env> [--stack cloud|platform]',
    help: 'Tạo và lưu bản xem trước',
  },
  apply: {
    env: 'required',
    usage: 'apply <env> [--stack …] [--confirm-data-loss]',
    help: 'Áp dụng đúng bản xem trước đã lưu',
  },
  up: {
    env: 'required',
    usage: 'up <env>',
    help: 'Dựng đầy đủ lần đầu (cloud → kubeconfig → platform → secrets init → DNS)',
  },
  outputs: { env: 'required', usage: 'outputs <env> [--json]', help: 'Đầu ra bàn giao cho H2/H3' },
  'dns-check': { env: 'required', usage: 'dns-check <env>', help: 'Tra DNS và kiểm chứng chỉ' },
  kubeconfig: {
    env: 'required',
    usage: 'kubeconfig <env>',
    help: 'Lấy kubeconfig vào infra/.credentials/',
  },
  secrets: {
    env: 'sub',
    usage: 'secrets init|set|rotate|list <env> …',
    help: 'Quản lý Secret của Kubernetes (init, set, rotate, list)',
  },
  drift: {
    env: 'required',
    usage: 'drift <env> [--stack cloud|platform]',
    help: 'Kiểm tra lệch (chỉ đọc)',
  },
  power: {
    env: 'required',
    usage: 'power staging off|on',
    help: 'Tắt/bật máy của môi trường thử nghiệm',
  },
  smoke: { env: 'required', usage: 'smoke <env>', help: 'Bộ kiểm tra khói và phép thử cô lập' },
  drill: {
    env: 'sub',
    usage: 'drill start|verify|destroy …',
    help: 'Diễn tập khôi phục CSDL ra môi trường tạm',
  },
  records: {
    env: 'required',
    usage: 'records <env> [--last N]',
    help: 'Liệt kê bản ghi áp dụng / diễn tập',
  },
};

/** Số lệnh người dùng thấy (mỗi lệnh con `secrets`/`drill` tính một) – khớp 19 dòng của hợp đồng. */
export const PUBLIC_COMMAND_COUNT = 19;

const HELP_LINES = [
  ['check', 'Kiểm tra tĩnh'],
  ['bootstrap-check <env>', 'Kiểm danh sách khởi tạo một lần'],
  ['plan <env> [--stack cloud|platform]', 'Tạo bản xem trước, lưu vào infra/.plans/<env>/'],
  ['apply <env> [--stack …] [--confirm-data-loss]', 'Áp dụng đúng bản xem trước đã lưu'],
  ['up <env>', 'Dựng đầy đủ cho lần đầu'],
  ['outputs <env> [--json]', 'Đầu ra bàn giao'],
  ['dns-check <env>', 'Tra DNS, kiểm chứng chỉ'],
  ['kubeconfig <env>', 'Lấy kubeconfig'],
  ['secrets init <env>', 'Tạo các Secret tự sinh nếu chưa có'],
  ['secrets set <env> <secret> <khóa>', 'Nhập một giá trị từ bàn phím'],
  ['secrets rotate <env> <tên>', 'Xoay mật khẩu / bí mật'],
  ['secrets list <env>', 'Liệt kê tên, khóa, nguồn (không giá trị)'],
  ['drift <env> [--stack cloud|platform]', 'Kiểm tra lệch'],
  ['power staging off|on', 'Tắt/bật môi trường thử nghiệm'],
  ['smoke <env>', 'Kiểm tra khói + phép thử cô lập'],
  ['drill start --from <env> --target-time <ISO>', 'Dựng môi trường tạm, khôi phục CSDL'],
  ['drill verify [--marker <sql>]', 'Kiểm tra, đo, ghi bản ghi diễn tập'],
  ['drill destroy', 'Hủy môi trường tạm'],
  ['records <env> [--last N]', 'Liệt kê bản ghi áp dụng / diễn tập'],
];

export function helpText() {
  const width = Math.max(...HELP_LINES.map(([u]) => u.length));
  const rows = HELP_LINES.map(([u, d]) => `  pnpm infra ${u.padEnd(width)}  ${d}`);
  return [
    'Dùng: pnpm infra <lệnh> [<env>] [tùy chọn]',
    `Môi trường: ${ENVIRONMENTS.join(' | ')}`,
    '',
    ...rows,
    '',
    'Không gọi `terraform` trực tiếp với môi trường thật – dùng các lệnh trên (infra/README.md).',
  ].join('\n');
}

/**
 * Phân tích đối số. Trả `{ ok: true, command, env, args, flags }` hoặc `{ ok: false, message }`.
 * `--tên giá_trị` và `--cờ` được gom vào `flags`; phần còn lại là `args` (thứ tự giữ nguyên).
 */
export function parseArgv(argv) {
  const [command, ...rest] = argv;
  if (command === '--help' || command === '-h' || command === 'help') {
    return { ok: false, help: true, message: '' };
  }
  if (command === undefined) return { ok: false, message: 'Thiếu lệnh.' };
  const spec = COMMANDS[command];
  if (spec === undefined) return { ok: false, message: `Lệnh lạ: "${command}".` };

  const args = [];
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token.startsWith('--')) {
      const name = token.slice(2);
      const eq = name.indexOf('=');
      if (eq >= 0) flags[name.slice(0, eq)] = name.slice(eq + 1);
      else if (rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) {
        flags[name] = rest[i + 1];
        i += 1;
      } else flags[name] = true;
    } else args.push(token);
  }

  let env;
  if (spec.env === 'required') {
    env = args.shift();
    if (env === undefined)
      return { ok: false, message: `Thiếu môi trường. Dùng: pnpm infra ${spec.usage}` };
    if (!ENVIRONMENTS.includes(env)) {
      return {
        ok: false,
        message: `Môi trường "${env}" không hợp lệ (chỉ ${ENVIRONMENTS.join(' hoặc ')}).`,
      };
    }
  }
  return { ok: true, command, env, args, flags };
}

export async function main(argv, deps = {}) {
  const log = deps.log ?? ((m) => console.error(m));
  const parsed = parseArgv(argv);
  if (!parsed.ok) {
    if (parsed.message !== '') log(parsed.message);
    log(helpText());
    return parsed.help === true ? EXIT.OK : EXIT.ERROR;
  }
  try {
    const load =
      deps.load ??
      ((name) => import(pathToFileURL(join(import.meta.dirname, 'commands', `${name}.mjs`)).href));
    const mod = await load(parsed.command);
    const code = await mod.run({ env: parsed.env, args: parsed.args, flags: parsed.flags });
    return typeof code === 'number' ? code : EXIT.OK;
  } catch (error) {
    if (error instanceof CliExit) {
      log(`✖ ${error.message}`);
      return error.exit;
    }
    // Chỉ in thông điệp: không in đối số, biến môi trường hay dấu vết có thể chứa bí mật.
    const message = error instanceof Error ? error.message : 'lỗi không xác định';
    log(`✖ ${parsed.command}: ${message}`);
    return EXIT.ERROR;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
