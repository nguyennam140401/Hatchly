import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig, resolveAuthConfig } from '../core';
import { DatabaseService, setActiveDatabase } from '../core/db/database';
import { createStaffOps, StaffInputError } from '../modules/account';

// Lệnh vận hành nhân viên nội bộ (004, contracts/auth-ops.md mục 2):
//   pnpm staff create --email <e> --name <tên> --role support|admin   (mật khẩu đọc từ stdin)
//   pnpm staff disable --email <e>
//   pnpm staff reset-password --email <e>                             (mật khẩu mới từ stdin)
//   pnpm staff list
// Ảnh container: node dist/ops/staff.js … . KHÔNG BAO GIỜ nhận mật khẩu qua tham số dòng lệnh (lộ
// trong lịch sử shell, danh sách tiến trình). Mã thoát: 0 thành công · 1 lỗi đầu vào/không tìm thấy ·
// 2 thiếu cấu hình hoặc không kết nối được.

export const EXIT_OK = 0;
export const EXIT_INPUT = 1;
export const EXIT_ENV = 2;

class UsageError extends Error {}

const USAGE = `Cách dùng:
  staff create --email <email> --name <tên> --role support|admin
  staff disable --email <email>
  staff reset-password --email <email>
  staff list
Mật khẩu đọc từ stdin (ẩn ký tự khi chạy ở terminal).`;

/** Đọc một dòng mật khẩu: terminal → ẩn ký tự; ống dẫn → dòng đầu của stdin. */
export async function readPassword(
  input: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin,
  output: NodeJS.WritableStream = process.stderr,
): Promise<string> {
  if (input.isTTY !== true) {
    let data = '';
    for await (const chunk of input) data += String(chunk);
    return data.split(/\r?\n/)[0] ?? '';
  }
  output.write('Mật khẩu: ');
  const rl = createInterface({ input, output, terminal: true });
  // Không in lại ký tự người dùng gõ.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => undefined;
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      output.write('\n');
      resolve(answer);
    });
  });
}

function requireOption(values: Record<string, unknown>, name: string): string {
  const v = values[name];
  if (typeof v !== 'string' || v.trim() === '') throw new UsageError(`Thiếu --${name}`);
  return v;
}

export async function runStaffCli(
  argv: string[],
  io: {
    env?: NodeJS.ProcessEnv;
    stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
    stdout?: NodeJS.WritableStream;
    stderr?: NodeJS.WritableStream;
  } = {},
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const [command, ...rest] = argv;
  let database: DatabaseService | undefined;
  try {
    const { values } = parseArgs({
      args: rest,
      options: {
        email: { type: 'string' },
        name: { type: 'string' },
        role: { type: 'string' },
      },
      strict: true,
    });
    if (
      command === undefined ||
      !['create', 'disable', 'reset-password', 'list'].includes(command)
    ) {
      throw new UsageError('Lệnh không hợp lệ');
    }

    let config;
    try {
      config = loadConfig(io.env ?? process.env);
    } catch (err) {
      if (err instanceof ConfigError) {
        stderr.write(`${err.message}\n`);
        return EXIT_ENV;
      }
      throw err;
    }
    const auth = resolveAuthConfig(config);
    database = new DatabaseService({
      unit: 'api',
      appEnv: config.APP_ENV,
      appUrl: config.DATABASE_APP_URL,
      poolMax: 2,
      statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS,
      idleInTxTimeoutMs: config.DATABASE_IDLE_IN_TX_TIMEOUT_MS,
      logger: {
        warn: () => undefined,
        error: () => undefined,
      },
    });
    setActiveDatabase(database);
    const ops = createStaffOps(auth);

    switch (command) {
      case 'create': {
        const email = requireOption(values, 'email');
        const name = requireOption(values, 'name');
        const role = requireOption(values, 'role');
        if (role !== 'support' && role !== 'admin') {
          throw new UsageError('--role phải là support hoặc admin');
        }
        const password = await readPassword(io.stdin, stderr);
        await ops.create({ email, displayName: name, role, password });
        stdout.write(`Đã tạo nhân viên ${email} (${role}).\n`);
        break;
      }
      case 'disable': {
        const email = requireOption(values, 'email');
        await ops.disable(email);
        stdout.write(`Đã khóa ${email} và thu hồi mọi phiên.\n`);
        break;
      }
      case 'reset-password': {
        const email = requireOption(values, 'email');
        const password = await readPassword(io.stdin, stderr);
        await ops.resetPassword(email, password);
        stdout.write(`Đã đặt lại mật khẩu cho ${email} và thu hồi mọi phiên.\n`);
        break;
      }
      case 'list': {
        for (const s of await ops.list()) {
          stdout.write(`${s.email}\t${s.displayName}\t${s.role}\t${s.status}\n`);
        }
        break;
      }
    }
    return EXIT_OK;
  } catch (err) {
    if (err instanceof UsageError || err instanceof StaffInputError) {
      stderr.write(`${err.message}\n`);
      if (err instanceof UsageError) stderr.write(`${USAGE}\n`);
      return EXIT_INPUT;
    }
    if ((err as { code?: unknown } | null)?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      stderr.write(`${(err as Error).message}\n${USAGE}\n`);
      return EXIT_INPUT;
    }
    // Không in thông điệp gốc (có thể chứa chuỗi kết nối) – chỉ mã.
    const code = (err as { code?: unknown } | null)?.code;
    stderr.write(`Không thực hiện được: ${typeof code === 'string' ? code : 'UNKNOWN'}\n`);
    return EXIT_ENV;
  } finally {
    await database?.close();
  }
}

if (require.main === module) {
  void runStaffCli(process.argv.slice(2)).then((code) => process.exit(code));
}
