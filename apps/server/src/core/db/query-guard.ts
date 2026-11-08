import type { PoolClient } from 'pg';
import type { AppEnv } from './database';
import { TenantContextError } from './errors';
import type { DbLogger } from './pools';
import { isTenantTable } from './table-registry';

// Bộ gác truy vấn bảng khách hàng trong giao dịch KHÔNG có tenant (research R5 lớp 2, FR-008).
// Drizzle luôn sinh định danh dạng "schema"."table" có ngoặc kép – quét chuỗi SQL là đủ; lớp chặn
// cuối vẫn là RLS ở CSDL (0 dòng).

const QUALIFIED_NAME = /"([a-z_][a-z0-9_]*)"\."([a-z_][a-z0-9_]*)"/g;

/** Bảng `tenant` đầu tiên mà câu SQL tham chiếu (dạng `schema.table`), hoặc undefined. */
export function findTenantTable(text: string): string | undefined {
  for (const match of text.matchAll(QUALIFIED_NAME)) {
    const [, schema, table] = match;
    if (schema !== undefined && table !== undefined && isTenantTable(schema, table)) {
      return `${schema}.${table}`;
    }
  }
  return undefined;
}

function sqlTextOf(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'object' && arg !== null) {
    const text = (arg as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return undefined;
}

export interface GuardOptions {
  appEnv: AppEnv;
  logger: DbLogger;
  traceId: () => string | null;
}

/**
 * Bọc `client.query` trong giao dịch không tenant. Trả hàm gỡ bọc – PHẢI gọi trước khi trả kết nối
 * về bể. development/test: ném `TENANT_CONTEXT_MISSING` nêu bảng; staging/production: ghi `warn`
 * có cấu trúc (không tham số/dữ liệu) rồi vẫn chạy – CSDL trả 0 dòng nhờ RLS.
 */
export function guardClient(client: PoolClient, options: GuardOptions): () => void {
  // Gọi lại bằng .apply(this, …) bên dưới – không mất ràng buộc `this`.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = client.query;
  const strict = options.appEnv === 'development' || options.appEnv === 'test';

  const guarded = function (this: PoolClient, ...args: unknown[]) {
    const text = sqlTextOf(args[0]);
    const table = text === undefined ? undefined : findTenantTable(text);
    if (table !== undefined) {
      if (strict)
        return Promise.reject(new TenantContextError('TENANT_CONTEXT_MISSING', { table }));
      options.logger.warn({
        event: 'db.tenant_context_missing',
        table,
        trace_id: options.traceId(),
      });
    }
    return (original as (...a: unknown[]) => unknown).apply(this, args);
  };
  client.query = guarded as typeof client.query;

  return () => {
    client.query = original;
  };
}
