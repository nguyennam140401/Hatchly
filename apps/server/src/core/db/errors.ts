// Lỗi của lớp CSDL (contracts/db-layer-api.md mục 6, research R15).
// Thông điệp KHÔNG BAO GIỜ chứa SQL, tham số, dữ liệu hay chuỗi kết nối.

export type TenantContextErrorCode =
  | 'TENANT_CONTEXT_MISSING'
  | 'TENANT_CONTEXT_INVALID'
  | 'TENANT_CONTEXT_CONFLICT'
  | 'TENANT_CONTEXT_FORBIDDEN'
  | 'TENANT_NOT_FOUND';

const TENANT_MESSAGES: Record<TenantContextErrorCode, string> = {
  TENANT_CONTEXT_MISSING: 'Thiếu ngữ cảnh tài khoản khi truy cập dữ liệu khách hàng',
  TENANT_CONTEXT_INVALID: 'Mã tài khoản trong ngữ cảnh không hợp lệ',
  TENANT_CONTEXT_CONFLICT: 'Giao dịch lồng nhau khác tài khoản hoặc khác vai trò',
  TENANT_CONTEXT_FORBIDDEN: 'Chỉ việc nền (Worker) được đặt ngữ cảnh tài khoản theo mã cho trước',
  TENANT_NOT_FOUND: 'Tài khoản trong ngữ cảnh không tồn tại',
};

/** Lỗi lập trình về ngữ cảnh tenant – khách hàng chỉ thấy INTERNAL_ERROR, mã gốc ở support.detail. */
export class TenantContextError extends Error {
  readonly code: TenantContextErrorCode;
  /** Bảng bị truy vấn ngoài ngữ cảnh (dạng `schema.table`), nếu biết. */
  readonly table: string | undefined;

  constructor(code: TenantContextErrorCode, options: { table?: string } = {}) {
    super(
      options.table === undefined
        ? TENANT_MESSAGES[code]
        : `${TENANT_MESSAGES[code]}: ${options.table}`,
    );
    this.name = 'TenantContextError';
    this.code = code;
    this.table = options.table;
  }
}

/** CSDL từ chối ghi vì vi phạm chính sách bảo mật mức dòng (SQLSTATE 42501). */
export class DbPolicyViolationError extends Error {
  readonly code = 'DB_POLICY_VIOLATION';

  constructor() {
    super('Ghi dữ liệu vi phạm chính sách cô lập tài khoản');
    this.name = 'DbPolicyViolationError';
  }
}

/** Không kết nối được / mất kết nối CSDL. Chỉ giữ mã lỗi (vd `ECONNREFUSED`, `28P01`). */
export class DbConnectionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Không kết nối được cơ sở dữ liệu (mã ${code})`);
    this.name = 'DbConnectionError';
    this.code = code;
  }
}

/**
 * Lỗi SQL khác (vd 23505 trùng khóa) đã làm sạch: chỉ giữ SQLSTATE và tên đối tượng. BỎ `detail`,
 * `where`, `internalQuery` của `pg` – chúng chứa GIÁ TRỊ dữ liệu (vd `Key (email)=(…)`), không được
 * lọt vào nhật ký (nguyên tắc VII).
 */
export class DbQueryError extends Error {
  readonly code: string;
  readonly constraint: string | undefined;
  readonly schema: string | undefined;
  readonly table: string | undefined;
  readonly column: string | undefined;

  constructor(source: {
    code: string;
    message: string;
    constraint?: string | undefined;
    schema?: string | undefined;
    table?: string | undefined;
    column?: string | undefined;
  }) {
    super(source.message);
    this.name = 'DbQueryError';
    this.code = source.code;
    this.constraint = source.constraint;
    this.schema = source.schema;
    this.table = source.table;
    this.column = source.column;
  }
}

/** Lỗi trả về từ máy chủ PostgreSQL (có `severity` và SQLSTATE 5 ký tự). */
function isServerError(err: unknown): err is Error & {
  code: string;
  constraint?: string;
  schema?: string;
  table?: string;
  column?: string;
} {
  return (
    err instanceof Error &&
    typeof (err as { severity?: unknown }).severity === 'string' &&
    /^[0-9A-Z]{5}$/.test(errorCode(err) ?? '')
  );
}

const NODE_CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

function errorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '';
}

/** Lỗi có phải do kết nối (cần hủy kết nối, không trả về bể)? */
export function isConnectionError(raw: unknown): boolean {
  const err = unwrapDriverError(raw);
  if (err instanceof DbConnectionError) return true;
  const code = errorCode(err);
  if (code !== undefined) {
    if (NODE_CONNECTION_CODES.has(code)) return true;
    // 08 – connection exception, 28 – xác thực, 3D000 – CSDL không tồn tại, 57P0x – máy chủ ngắt.
    if (/^(08|28)/.test(code) || code === '3D000' || /^57P0[1-3]$/.test(code)) return true;
  }
  const message = errorMessage(err);
  return /Connection terminated|connection.*(closed|ended)|Client has encountered a connection error/i.test(
    message,
  );
}

/**
 * Drizzle bọc lỗi trình điều khiển trong `DrizzleQueryError` có thông điệp "Failed query: <SQL>
 * params: <tham số>" – KHÔNG được lan ra nhật ký/phản hồi. Bóc tới lỗi gốc (có `code`).
 */
function unwrapDriverError(err: unknown): unknown {
  let current = err;
  for (let depth = 0; depth < 5; depth++) {
    if (!(current instanceof Error) || errorCode(current) !== undefined) return current;
    const cause = (current as { cause?: unknown }).cause;
    if (cause === undefined) return current;
    current = cause;
  }
  return current;
}

/**
 * Chuẩn hóa lỗi của `pg`/Drizzle:
 * - bóc `DrizzleQueryError` (thông điệp chứa SQL và tham số) về lỗi gốc của trình điều khiển;
 * - 42501 + "row-level security" → `DbPolicyViolationError`;
 * - lỗi kết nối → `DbConnectionError` chỉ có mã (không giữ thông điệp gốc – có thể chứa máy chủ, người dùng);
 * - lỗi khác: lỗi gốc của trình điều khiển (không có tham số truy vấn).
 */
export function normalizePgError(raw: unknown): unknown {
  const err = unwrapDriverError(raw);
  if (
    err instanceof TenantContextError ||
    err instanceof DbPolicyViolationError ||
    err instanceof DbConnectionError
  ) {
    return err;
  }
  const code = errorCode(err);
  if (code === '42501' && /row-level security/i.test(errorMessage(err))) {
    return new DbPolicyViolationError();
  }
  if (isConnectionError(err)) {
    return new DbConnectionError(code ?? 'CONNECTION_TERMINATED');
  }
  if (isServerError(err)) {
    return new DbQueryError({
      code: err.code,
      message: err.message,
      constraint: err.constraint,
      schema: err.schema,
      table: err.table,
      column: err.column,
    });
  }
  return err;
}
