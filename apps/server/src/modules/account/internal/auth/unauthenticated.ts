import { unauthenticated } from '../../../../core/auth/auth-errors';

/** Phiên hợp lệ nhưng không còn người dùng/thành viên (hiếm) → 401 như chưa đăng nhập. */
export function unauthenticatedMe() {
  return unauthenticated('customer', 'user_missing');
}
