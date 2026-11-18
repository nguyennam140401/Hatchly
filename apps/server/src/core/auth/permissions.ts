// Danh mục quyền phía máy chủ (FR-012, contracts/authz-api.md mục 1). Dữ liệu là NGUỒN DUY NHẤT ở
// @app/shared/auth (web dùng cùng bảng); ở đây chỉ thêm thông điệp từ chối theo quyền.
import {
  isCustomerPermission,
  PERMISSION_LIST,
  PERMISSIONS,
  permissionsOf,
  roleHasPermission,
  type CustomerRole,
  type Permission,
  type Role,
  type StaffRole,
} from '@app/shared/auth';

export {
  isCustomerPermission,
  PERMISSION_LIST,
  PERMISSIONS,
  permissionsOf,
  roleHasPermission,
  type CustomerRole,
  type Permission,
  type Role,
  type StaffRole,
};

/** Lời giải thích tiếng Việt đời thường khi thiếu từng quyền (FR-017, nguyên tắc VI). */
export const PERMISSION_DENIED_MESSAGES: Record<Permission, string> = {
  'context.view': 'Bạn không có quyền xem hồ sơ kinh doanh.',
  'context.edit': 'Chỉ chủ tài khoản mới sửa được hồ sơ kinh doanh.',
  'channel.manage': 'Chỉ chủ tài khoản mới kết nối được kênh.',
  'channel.view': 'Bạn không có quyền xem các kênh đã kết nối.',
  'feature.manage': 'Chỉ quản trị viên mới bật hoặc tắt được tính năng cho khách hàng.',
  'post.edit': 'Bạn không có quyền soạn hoặc sửa bài.',
  'media.upload': 'Bạn không có quyền tải ảnh, video lên.',
  'media.view': 'Bạn không có quyền xem thư viện ảnh, video.',
  'media.delete': 'Bạn không có quyền xóa ảnh, video.',
  'post.approve': 'Chỉ chủ tài khoản mới duyệt được bài.',
  'post.reschedule': 'Bạn không có quyền đổi giờ đăng bài.',
  'post.republish': 'Bạn không có quyền đăng lại bài.',
  'status.view': 'Bạn không có quyền xem trạng thái đăng bài.',
  'members.manage': 'Chỉ chủ tài khoản mới mời hoặc gỡ được cộng tác viên.',
  'account.delete': 'Chỉ chủ tài khoản mới xóa được tài khoản.',
  'support.lookup': 'Chỉ nhân viên hỗ trợ mới tra cứu được dữ liệu khách hàng.',
  'plan.manage': 'Chỉ quản trị viên mới thay đổi được gói dịch vụ.',
  'staff.manage': 'Chỉ quản trị viên mới quản lý được nhân viên.',
};

/**
 * Nhãn hành động `contact_owner` riêng theo quyền (006 contracts/context-http-api.md mục 2); quyền
 * không có ở đây dùng nhãn mặc định "Nhờ chủ tài khoản".
 */
export const PERMISSION_CONTACT_OWNER_LABELS: Partial<Record<Permission, string>> = {
  'context.edit': 'Nhờ chủ tài khoản cập nhật',
};
