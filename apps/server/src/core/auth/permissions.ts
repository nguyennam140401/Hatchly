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
  'context.manage': 'Chỉ chủ tài khoản mới sửa được thông tin kinh doanh.',
  'channel.manage': 'Chỉ chủ tài khoản mới kết nối được kênh.',
  'post.edit': 'Bạn không có quyền soạn hoặc sửa bài.',
  'media.upload': 'Bạn không có quyền tải ảnh, video lên.',
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
