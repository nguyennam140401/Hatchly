// Danh mục quyền (FR-012, contracts/authz-api.md mục 1) – NGUỒN DUY NHẤT cho web và máy chủ.
// Máy chủ (core/auth/permissions.ts) nhập lại từ đây; web dùng để ẩn/hiện nút (chỉ là trải nghiệm,
// API vẫn tự chặn). Thêm quyền: thêm một dòng kèm truy vết FR, rồi cập nhật ma trận kiểm thử (SC-003).
// Đổi quyền của vai trò có sẵn phải được review theo nguyên tắc VI.

export const PERMISSIONS = {
  /**
   * Xem hồ sơ kinh doanh (FR-01, 006 R9) –
   * TaiLieuDacTa/Dac_ta_yeu_cau_App_AI_Content_MXH.md#pq-context-view.
   */
  'context.view': { owner: true, collaborator: true, support: false, admin: false },
  /**
   * Sửa hồ sơ kinh doanh – chỉ chủ (FR-01, 006 R9) –
   * TaiLieuDacTa/Dac_ta_yeu_cau_App_AI_Content_MXH.md#pq-context-edit.
   */
  'context.edit': { owner: true, collaborator: false, support: false, admin: false },
  /** Kết nối/ngắt kênh (FR-02). */
  'channel.manage': { owner: true, collaborator: false, support: false, admin: false },
  /** Xem màn hình Kênh kết nối – chủ và cộng tác viên, chỉ đọc (010 FR-027). */
  'channel.view': { owner: true, collaborator: true, support: false, admin: false },
  /**
   * Đổi công tắc tính năng theo tài khoản/mặc định hệ thống (010 FR-037) – chỉ quản trị nội bộ;
   * `support` KHÔNG có (chỉ xem), chủ/CTV không bao giờ tự bật.
   */
  'feature.manage': { owner: false, collaborator: false, support: false, admin: true },
  /** Soạn, sửa bài (FR-05). */
  'post.edit': { owner: true, collaborator: true, support: false, admin: false },
  /** Tải media (FR-03). */
  'media.upload': { owner: true, collaborator: true, support: false, admin: false },
  /** Duyệt + lên lịch bài mới duyệt (FR-06, nguyên tắc VI). */
  'post.approve': { owner: true, collaborator: false, support: false, admin: false },
  /** Đổi giờ bài đã duyệt (FR-06). */
  'post.reschedule': { owner: true, collaborator: true, support: false, admin: false },
  /** Đăng lại bài lỗi (FR-09). */
  'post.republish': { owner: true, collaborator: true, support: false, admin: false },
  /** Trạng thái, nhật ký đăng, mức sử dụng dạng % (FR-08, FR-12). */
  'status.view': { owner: true, collaborator: true, support: false, admin: false },
  /** Mời/gỡ cộng tác viên (FR-15). */
  'members.manage': { owner: true, collaborator: false, support: false, admin: false },
  /** Xóa tài khoản (FR-14). */
  'account.delete': { owner: true, collaborator: false, support: false, admin: false },
  /** Tra cứu hỗ trợ qua supportSearch/supportViewAccount (FR-10). */
  'support.lookup': { owner: false, collaborator: false, support: true, admin: true },
  /** Kích hoạt, gia hạn, tạm dừng gói (FR-10). */
  'plan.manage': { owner: false, collaborator: false, support: false, admin: true },
  /** Quản lý nhân viên nội bộ (FR-016). */
  'staff.manage': { owner: false, collaborator: false, support: false, admin: true },
} as const satisfies Record<
  string,
  { owner: boolean; collaborator: boolean; support: boolean; admin: boolean }
>;

export type Permission = keyof typeof PERMISSIONS;
export type CustomerRole = 'owner' | 'collaborator';
export type StaffRole = 'support' | 'admin';
export type Role = CustomerRole | StaffRole;

export const CUSTOMER_ROLES = ['owner', 'collaborator'] as const satisfies readonly CustomerRole[];
export const STAFF_ROLES = ['support', 'admin'] as const satisfies readonly StaffRole[];

/** Mọi quyền theo thứ tự khai báo. */
export const PERMISSION_LIST = Object.keys(PERMISSIONS) as Permission[];

/** Các quyền của một vai trò, theo thứ tự khai báo. */
export function permissionsOf(role: Role): Permission[] {
  return PERMISSION_LIST.filter((permission) => PERMISSIONS[permission][role]);
}

/** Vai trò có quyền này không. */
export function roleHasPermission(role: Role, permission: Permission): boolean {
  return PERMISSIONS[permission][role];
}

/** Quyền dành cho khách hàng (chủ hoặc cộng tác viên có), phần còn lại là quyền nội bộ. */
export function isCustomerPermission(permission: Permission): boolean {
  const row = PERMISSIONS[permission];
  return row.owner || row.collaborator;
}
