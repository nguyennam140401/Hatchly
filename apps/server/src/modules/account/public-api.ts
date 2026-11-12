import type { StaffRole } from '../../core';

/**
 * Giao diện công khai của module Tài khoản & Gói (`account`).
 *
 * Trách nhiệm (ADD mục 6): Đăng ký/đăng nhập (email, Google, Facebook), chủ tài khoản và tối đa 2 cộng tác viên, gói và chu kỳ, hạn mức (100 bài/chu kỳ, 5 GB), kích hoạt/gia hạn/tạm dừng gói bởi quản trị nội bộ.
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `account` trong `allowedDeps` của mình ở modules.manifest.json.
 *
 * Xác thực/phân quyền cho điểm cuối của module khác KHÔNG đi qua đây: dùng khai báo truy cập và
 * `currentActor()` của core (004).
 */
/** Thành viên đang hoạt động của tài khoản trong ngữ cảnh (005 – người nhận thông báo). */
export interface ActiveMember {
  userId: string;
  role: 'owner' | 'collaborator';
  email: string;
  displayName: string;
}

export interface AccountPublicApi {
  /**
   * Thành viên đang hoạt động (chủ + cộng tác viên) của tài khoản trong ngữ cảnh – đọc qua tenantTx,
   * không nhận mã tài khoản (nguyên tắc I). Thành viên đã gỡ/khóa không có trong danh sách. Có ở cả API
   * và Worker (005, R9 – Thông báo tra người nhận).
   */
  listActiveMembers(): Promise<ActiveMember[]>;
  /**
   * Thêm cộng tác viên vào tài khoản (ghế trống nhỏ nhất; đủ 2 → SEATS_FULL).
   * CHỈ cho kiểm thử, dữ liệu mẫu; luồng mời người dùng cuối ở WBS 4.4. `accountId` phải là tài
   * khoản đã xác minh của người gọi.
   */
  addMember(input: {
    accountId: string;
    displayName: string;
    email: string;
    password?: string | undefined;
    emailVerified?: boolean | undefined;
    addedByUserId: string;
  }): Promise<{ userId: string; seat: number }>;
  /** Gỡ cộng tác viên (chủ → OWNER_REQUIRED); thu hồi mọi phiên của người đó. Chỉ kiểm thử/dữ liệu mẫu. */
  removeMember(input: { accountId: string; userId: string; byUserId: string }): Promise<void>;
  /** Khóa cộng tác viên; thu hồi mọi phiên của người đó. Chỉ kiểm thử/dữ liệu mẫu. */
  disableMember(input: { accountId: string; userId: string; byUserId: string }): Promise<void>;
  /**
   * Tạo chủ tài khoản đã xác minh email, không gửi thư; email đã có → trả tài khoản sẵn có.
   * CHỈ cho dữ liệu mẫu/kiểm thử (`pnpm dev:seed-auth`); người dùng thật đăng ký qua /auth/register.
   */
  createVerifiedOwner(input: {
    displayName: string;
    email: string;
    password: string;
  }): Promise<{ accountId: string; userId: string; created: boolean }>;
  /**
   * Tên hiển thị và trạng thái của các người dùng thuộc tài khoản trong ngữ cảnh (006).
   * Người không thuộc tài khoản này (hoặc mã không tồn tại) không có trong kết quả.
   * Chạy trong tenantTx của người gọi – không nhận accountId; không ngữ cảnh → TENANT_CONTEXT_MISSING.
   * Tối đa 100 mã mỗi lần (vượt → lỗi lập trình).
   */
  describeMembers(
    userIds: readonly string[],
  ): Promise<{ userId: string; displayName: string; status: 'active' | 'removed' | 'disabled' }[]>;
  /** Tạo nhân viên nội bộ (dùng bởi dữ liệu mẫu; vận hành dùng `pnpm staff`). */
  createStaff(input: {
    email: string;
    displayName: string;
    role: StaffRole;
    password: string;
  }): Promise<{ id: string }>;
}

/** Token NestJS của AccountPublicApi. */
export const ACCOUNT_PUBLIC_API = Symbol('ACCOUNT_PUBLIC_API');
