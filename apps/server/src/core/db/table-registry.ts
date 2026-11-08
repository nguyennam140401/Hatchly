// Sổ đăng ký bảng trong tiến trình (data-model mục 6, research R8). Nguồn cho bộ gác truy vấn
// ngoài ngữ cảnh (R5) và lệnh kiểm tra quy ước `pnpm db:check` (R12). Không lưu trong CSDL.

export type TableKind = 'tenant' | 'shared' | 'partitioned_log';

export interface TableRegistration {
  schema: string;
  name: string;
  kind: TableKind;
  /** Cột mã tài khoản: `account_id`; riêng `account.accounts` là `id`. */
  tenantColumn: 'account_id' | 'id' | null;
  /** Tên chỉ mục → lý do không bắt đầu bằng `account_id`. */
  indexExceptions: Record<string, string>;
  /** Bắt buộc với `shared`. */
  reason?: string;
  /**
   * Chỉ cho `tenant` có cột mã tài khoản cho phép NULL (vd `infra.dead_jobs` – việc hệ thống không
   * thuộc tài khoản nào). PHẢI ghi lý do (quy tắc l của db:check).
   */
  nullableTenant?: { reason: string };
}

const registry = new Map<string, TableRegistration>();

const keyOf = (schema: string, name: string) => `${schema}.${name}`;

/** Đăng ký một bảng; trùng `schema.name` → lỗi (hai định nghĩa cho cùng một bảng). */
export function registerTable(entry: TableRegistration): void {
  const key = keyOf(entry.schema, entry.name);
  if (registry.has(key)) throw new Error(`Bảng ${key} đã được đăng ký`);
  registry.set(key, entry);
}

/** Toàn bộ sổ đăng ký (chỉ đọc) – cho db:check. Không xuất qua core/index.ts. */
export function tableRegistry(): ReadonlyMap<string, TableRegistration> {
  return registry;
}

/**
 * Bảng khách hàng mà bộ gác truy vấn phải chặn khi giao dịch không có tenant. Bảng `nullableTenant`
 * (vd `infra.dead_jobs`) có dòng không thuộc tài khoản nào nên được truy cập ngoài tenant – chính sách
 * RLS của bảng chỉ cho thấy dòng `account_id IS NULL` trong ngữ cảnh đó (003 data-model mục 5).
 */
export function isTenantTable(schema: string, name: string): boolean {
  const entry = registry.get(keyOf(schema, name));
  return entry?.kind === 'tenant' && entry.nullableTenant === undefined;
}
