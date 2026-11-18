import 'reflect-metadata';
import { isCustomerPermission, type Permission } from './permissions';

// Khai báo truy cập cho điểm cuối (FR-013, contracts/authz-api.md mục 2). MỌI handler phải có đúng
// một khai báo (đặt ở method, hoặc ở class làm mặc định – method ghi đè class). Không có khai báo →
// AccessGuard từ chối 403 ACCESS_NOT_DECLARED (mặc định từ chối).

export type AccessDeclaration =
  | { kind: 'public' }
  | {
      kind: 'customer';
      permissions: Permission[];
      allowUnverifiedEmail: boolean;
      /** 009: cho phép người đang ở tài khoản chờ (không thuộc tài khoản nào). */
      allowDetached: boolean;
    }
  | { kind: 'staff'; permissions: Permission[] };

const ACCESS_KEY = Symbol('access-declaration');

type Target = object;

function attach(declaration: AccessDeclaration): MethodDecorator & ClassDecorator {
  return (target: Target, _key?: string | symbol, descriptor?: PropertyDescriptor) => {
    // Method: gắn lên hàm xử lý; class: gắn lên hàm dựng. Danh sách để phát hiện khai báo trùng.
    const holder = (descriptor?.value ?? target) as Target;
    const existing =
      (Reflect.getOwnMetadata(ACCESS_KEY, holder) as AccessDeclaration[] | undefined) ?? [];
    Reflect.defineMetadata(ACCESS_KEY, [...existing, declaration], holder);
  };
}

/** Không cần đăng nhập. Có phiên hợp lệ thì guard vẫn gắn người gọi (không gắn tài khoản). */
export function Public(): MethodDecorator & ClassDecorator {
  return attach({ kind: 'public' });
}

export interface CustomerAccessOptions {
  /** Cho phép cả khi email chưa xác nhận (vd /auth/me, đăng xuất, sửa email). */
  allowUnverifiedEmail?: boolean;
  /**
   * 009: cho phép cả người không thuộc tài khoản nào (tài khoản chờ) – chỉ cho điểm cuối CÁ NHÂN (tôi
   * là ai, đăng xuất, cách đăng nhập, lời mời của tôi, tạo tài khoản riêng). KHÔNG dùng kèm quyền:
   * người ở tài khoản chờ không có quyền nào (kiểm khi khởi động).
   */
  allowDetached?: boolean;
}

/**
 * Khách hàng đã đăng nhập, có ĐỦ mọi quyền liệt kê; mặc định đòi email đã xác nhận.
 * `@CustomerAccess({ allowUnverifiedEmail: true })` – chỉ cần đăng nhập.
 * Mặc định TỪ CHỐI người ở tài khoản chờ (403 NO_ACCOUNT); mở bằng `allowDetached: true`.
 */
export function CustomerAccess(
  ...args: [CustomerAccessOptions, ...Permission[]] | Permission[]
): MethodDecorator & ClassDecorator {
  const [first, ...rest] = args;
  const options: CustomerAccessOptions = typeof first === 'object' ? first : {};
  const permissions = (typeof first === 'object' ? rest : args) as Permission[];
  for (const p of permissions) {
    if (!isCustomerPermission(p)) {
      throw new Error(`@CustomerAccess không nhận quyền nội bộ "${p}"`);
    }
  }
  return attach({
    kind: 'customer',
    permissions,
    allowUnverifiedEmail: options.allowUnverifiedEmail === true,
    allowDetached: options.allowDetached === true,
  });
}

/** Nhân viên nội bộ đã đăng nhập ở lối vào nội bộ, có ĐỦ mọi quyền liệt kê. */
export function StaffAccess(...permissions: Permission[]): MethodDecorator & ClassDecorator {
  for (const p of permissions) {
    if (isCustomerPermission(p)) {
      throw new Error(`@StaffAccess không nhận quyền của khách hàng "${p}"`);
    }
  }
  return attach({ kind: 'staff', permissions });
}

/** Lỗi lập trình: một handler (hoặc class) có nhiều hơn một khai báo. */
export class DuplicateAccessDeclarationError extends Error {
  constructor(readonly where: string) {
    super(`${where} có nhiều hơn một khai báo truy cập (@Public/@CustomerAccess/@StaffAccess)`);
    this.name = 'DuplicateAccessDeclarationError';
  }
}

function own(holder: Target): AccessDeclaration[] {
  return (Reflect.getOwnMetadata(ACCESS_KEY, holder) as AccessDeclaration[] | undefined) ?? [];
}

/**
 * Khai báo hiệu lực của handler: của method, nếu không có thì của class; `null` khi không có.
 * Ném `DuplicateAccessDeclarationError` khi method hoặc class có hai khai báo.
 */
export function readAccessDeclaration(
  handler: (...args: never[]) => unknown,
  controller: abstract new (...args: never[]) => unknown,
): AccessDeclaration | null {
  const onMethod = own(handler);
  if (onMethod.length > 1) {
    throw new DuplicateAccessDeclarationError(`${controller.name}.${handler.name}`);
  }
  if (onMethod[0] !== undefined) return onMethod[0];
  const onClass = own(controller);
  if (onClass.length > 1) throw new DuplicateAccessDeclarationError(controller.name);
  return onClass[0] ?? null;
}
