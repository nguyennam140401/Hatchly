import type { CustomerRole, StaffRole } from '@app/shared/auth';

// Kiểu "người gọi" gắn vào ngữ cảnh thực thi (004, data-model.md mục 7, contracts/authz-api.md mục 3).
// Đặt ở core/context (không ở core/auth) để execution-storage dùng được mà không tạo vòng phụ thuộc.

export interface CustomerActor {
  kind: 'user';
  userId: string;
  accountId: string;
  role: CustomerRole;
  emailVerified: boolean;
  sessionId: string;
  /**
   * 009 (research R6, R7): tài khoản của phiên đang là tài khoản chờ (`accounts.status = 'unclaimed'`)
   * – người dùng không thuộc tài khoản nào. Không có quyền nào; chỉ vào được điểm cuối khai báo
   * `allowDetached`.
   */
  detached: boolean;
}

export interface StaffActor {
  kind: 'staff';
  staffId: string;
  role: StaffRole;
  sessionId: string;
}

export type Actor = CustomerActor | StaffActor;
