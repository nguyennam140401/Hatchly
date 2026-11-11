import { AUTH_ERROR_MESSAGES, ERROR_CODES } from '@app/shared/core';
import { AppError } from '../errors/app-error';
import { PERMISSION_DENIED_MESSAGES, type Permission, type Role } from './permissions';

// Lỗi của lớp chặn quyền (contracts/auth-http-api.md mục 3). Thông điệp tiếng Việt đời thường, luôn
// kèm ít nhất một hành động khắc phục (nguyên tắc VI); mã gốc chỉ ở `support.detail`.

export function unauthenticated(audience: 'customer' | 'staff', detail: string): AppError {
  return new AppError({
    code: ERROR_CODES.UNAUTHENTICATED,
    httpStatus: 401,
    message: AUTH_ERROR_MESSAGES.UNAUTHENTICATED,
    actions: [
      {
        kind: 'navigate',
        label: 'Đăng nhập',
        href: audience === 'staff' ? '/internal/login' : '/login',
      },
    ],
    detail,
  });
}

export function emailNotVerified(): AppError {
  return new AppError({
    code: ERROR_CODES.EMAIL_NOT_VERIFIED,
    httpStatus: 403,
    message: AUTH_ERROR_MESSAGES.EMAIL_NOT_VERIFIED,
    actions: [{ kind: 'resend_verification', label: 'Gửi lại thư xác nhận' }],
  });
}

export function forbidden(missing: Permission, role: Role): AppError {
  return new AppError({
    code: ERROR_CODES.FORBIDDEN,
    httpStatus: 403,
    message: PERMISSION_DENIED_MESSAGES[missing],
    actions:
      role === 'collaborator'
        ? [
            { kind: 'navigate', label: 'Quay lại', href: '/' },
            { kind: 'contact_owner', label: 'Nhờ chủ tài khoản' },
          ]
        : [{ kind: 'navigate', label: 'Quay lại', href: '/' }],
    detail: `missing_permission:${missing}`,
  });
}

export function accessNotDeclared(): AppError {
  return new AppError({
    code: ERROR_CODES.ACCESS_NOT_DECLARED,
    httpStatus: 403,
    message: AUTH_ERROR_MESSAGES.ACCESS_NOT_DECLARED,
    actions: [{ kind: 'contact_support', label: 'Liên hệ hỗ trợ' }],
    detail: 'access_not_declared',
  });
}

export function ipNotAllowed(): AppError {
  return new AppError({
    code: ERROR_CODES.IP_NOT_ALLOWED,
    httpStatus: 403,
    message: AUTH_ERROR_MESSAGES.IP_NOT_ALLOWED,
    actions: [{ kind: 'contact_support', label: 'Liên hệ quản trị' }],
  });
}

/** Không tra được phiên (CSDL lỗi) – KHÔNG cho qua. */
export function authUnavailable(detail: string): AppError {
  return new AppError({
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    httpStatus: 503,
    message: 'Hệ thống đang tạm dừng để cập nhật. Vui lòng thử lại sau ít phút.',
    actions: [{ kind: 'retry', label: 'Thử lại' }],
    detail,
  });
}
