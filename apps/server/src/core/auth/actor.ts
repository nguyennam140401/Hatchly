import type { Actor, CustomerActor, StaffActor } from '../context/actor.types';
import { getExecutionContext } from '../context/request-context';
import { roleHasPermission, type Permission } from './permissions';

// Đọc người gọi của yêu cầu hiện tại (FR-015, contracts/authz-api.md mục 3). Chặn truy cập điểm cuối
// vẫn phải dùng khai báo @CustomerAccess/@StaffAccess; `can()` dành cho quyết định TRONG nghiệp vụ.
// Mã tài khoản của khách hàng đọc bằng `currentAccountId()` (002) – guard đã gắn từ phiên.

export type { Actor, CustomerActor, StaffActor };

/** Người gọi đã xác thực, hoặc null (chưa đăng nhập, việc nền). */
export function currentActor(): Actor | null {
  return getExecutionContext()?.actor ?? null;
}

/** Người gọi là khách hàng; ném lỗi lập trình nếu không phải (điểm cuối khai báo sai). */
export function requireCustomer(): CustomerActor {
  const actor = currentActor();
  if (actor?.kind !== 'user') {
    throw new Error(
      'requireCustomer(): người gọi không phải khách hàng – kiểm tra @CustomerAccess',
    );
  }
  return actor;
}

/** Người gọi là nhân viên nội bộ; ném lỗi lập trình nếu không phải. */
export function requireStaff(): StaffActor {
  const actor = currentActor();
  if (actor?.kind !== 'staff') {
    throw new Error(
      'requireStaff(): người gọi không phải nhân viên nội bộ – kiểm tra @StaffAccess',
    );
  }
  return actor;
}

/** Người gọi hiện tại có quyền này không (false khi chưa đăng nhập). */
export function can(permission: Permission): boolean {
  const actor = currentActor();
  return actor !== null && roleHasPermission(actor.role, permission);
}
