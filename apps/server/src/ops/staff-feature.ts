import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../core';
import { DatabaseService, setActiveDatabase } from '../core/db/database';
import { FeatureGate } from '../modules/platform_gateway/internal/features/feature-gate';
import { FeaturesService } from '../modules/platform_gateway/internal/features/features.service';

// Lệnh vận hành công tắc tính năng (010 T082, contracts/feature-flags.md mục 5) – bọc CÙNG `FeaturesService` của điểm cuối nhân viên
// nên cùng kiểm toán (`feature_override_events` + `infra.audit_log`). Gọi qua `pnpm staff feature …`:
//   feature get [--account <uuid>]
//   feature set-default --value on|off --reason "…" --staff-id <uuid> [--role admin|support]
//   feature set --account <uuid> --value on|off|default --reason "…" --staff-id <uuid> [--role admin|support]
// Không có đường "chạy thẳng SQL": mọi thay đổi đi qua hàm SECURITY DEFINER có kiểm toán. `--staff-id` bắt buộc (nhân viên thực hiện).
// Mã thoát: 0 thành công · 1 lỗi đầu vào · 2 thiếu cấu hình/không kết nối được.

const FLAG = 'channel.tiktok' as const;

class UsageError extends Error {}

const USAGE = `Cách dùng:
  staff feature get [--account <uuid>]
  staff feature set-default --value on|off --reason "<lý do>" --staff-id <uuid> [--role admin|support]
  staff feature set --account <uuid> --value on|off|default --reason "<lý do>" --staff-id <uuid> [--role admin|support]`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function need(values: Record<string, unknown>, name: string): string {
  const v = values[name];
  if (typeof v !== 'string' || v.trim() === '') throw new UsageError(`Thiếu --${name}`);
  return v.trim();
}

export async function runStaffFeatureCli(
  argv: string[],
  io: {
    env?: NodeJS.ProcessEnv;
    stdout?: NodeJS.WritableStream;
    stderr?: NodeJS.WritableStream;
  } = {},
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let database: DatabaseService | undefined;
  try {
    const [sub, ...rest] = argv;
    const { values } = parseArgs({
      args: rest,
      options: {
        account: { type: 'string' },
        value: { type: 'string' },
        reason: { type: 'string' },
        'staff-id': { type: 'string' },
        role: { type: 'string' },
      },
      strict: true,
    });
    if (sub === undefined || !['get', 'set-default', 'set'].includes(sub)) {
      throw new UsageError('Lệnh con không hợp lệ');
    }
    const account = typeof values.account === 'string' ? values.account : undefined;
    if (account !== undefined && !UUID.test(account))
      throw new UsageError('--account phải là UUID');

    let config;
    try {
      config = loadConfig(io.env ?? process.env);
    } catch (err) {
      if (err instanceof ConfigError) {
        stderr.write(`${err.message}\n`);
        return 2;
      }
      throw err;
    }
    if (config.DATABASE_SUPPORT_URL === undefined) {
      stderr.write('Thiếu DATABASE_SUPPORT_URL\n');
      return 2;
    }
    database = new DatabaseService({
      unit: 'api',
      appEnv: config.APP_ENV,
      appUrl: config.DATABASE_APP_URL,
      supportUrl: config.DATABASE_SUPPORT_URL,
      poolMax: 2,
      statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS,
      idleInTxTimeoutMs: config.DATABASE_IDLE_IN_TX_TIMEOUT_MS,
      logger: { warn: () => undefined, error: () => undefined },
    });
    setActiveDatabase(database);
    const service = new FeaturesService(
      new FeatureGate({
        readOverride: () => Promise.resolve(null),
        readDefault: () => Promise.resolve(false),
      }),
    );

    if (sub === 'get') {
      stdout.write(`${JSON.stringify(await service.get(FLAG, account))}\n`);
      return 0;
    }
    const staffId = need(values, 'staff-id');
    if (!UUID.test(staffId)) throw new UsageError('--staff-id phải là UUID');
    const role = values.role ?? 'admin';
    if (role !== 'admin' && role !== 'support')
      throw new UsageError('--role phải là admin hoặc support');
    const reason = need(values, 'reason');
    if (reason.length > 500) throw new UsageError('--reason tối đa 500 ký tự');
    const value = need(values, 'value');
    const staff = { staffId, role } as const;

    if (sub === 'set-default') {
      if (value !== 'on' && value !== 'off') throw new UsageError('--value phải là on hoặc off');
      const { old } = await service.setDefault(staff, FLAG, value === 'on', reason);
      stdout.write(`Đã đổi mặc định ${FLAG}: ${old ? 'on' : 'off'} → ${value}\n`);
      return 0;
    }
    if (account === undefined) throw new UsageError('Thiếu --account');
    if (value !== 'on' && value !== 'off' && value !== 'default') {
      throw new UsageError('--value phải là on, off hoặc default');
    }
    const { old } = await service.setForAccount(staff, account, FLAG, value, reason);
    stdout.write(`Đã đổi ${FLAG} của ${account}: ${old} → ${value}\n`);
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      stderr.write(`${err.message}\n${USAGE}\n`);
      return 1;
    }
    if ((err as { code?: unknown } | null)?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      stderr.write(`${(err as Error).message}\n${USAGE}\n`);
      return 1;
    }
    // Không in thông điệp gốc (có thể chứa chuỗi kết nối) – chỉ mã.
    const code = (err as { code?: unknown } | null)?.code;
    stderr.write(`Không thực hiện được: ${typeof code === 'string' ? code : 'UNKNOWN'}\n`);
    return 2;
  } finally {
    await database?.close();
  }
}
