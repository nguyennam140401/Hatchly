import { AUTH_ERROR_MESSAGES, ERROR_CODES, loginThrottledMessage } from '@app/shared/core';
import { AppError } from '../../../../core';

// Lỗi có chủ đích của luồng xác thực (contracts/auth-http-api.md mục 3). Mã gốc chỉ ở
// `support.detail`; riêng INVALID_CREDENTIALS luôn `invalid_credentials` để không lộ lý do.

const FORGOT = { kind: 'navigate', label: 'Quên mật khẩu', href: '/forgot-password' } as const;

export function invalidCredentials(field: 'password' | 'currentPassword' = 'password'): AppError {
  return new AppError({
    code: ERROR_CODES.INVALID_CREDENTIALS,
    httpStatus: 401,
    message: AUTH_ERROR_MESSAGES.INVALID_CREDENTIALS,
    actions: [{ kind: 'fix_input', label: 'Nhập lại' }, FORGOT],
    ...(field === 'currentPassword'
      ? {
          fieldErrors: [{ path: ['currentPassword'], message: 'Mật khẩu hiện tại chưa đúng.' }],
        }
      : {}),
    detail: 'invalid_credentials',
  });
}

/** 429 – kèm số giây cho tiêu đề `Retry-After`. */
export class LoginThrottledError extends AppError {
  constructor(retryAfterSeconds: number) {
    super({
      code: ERROR_CODES.LOGIN_THROTTLED,
      httpStatus: 429,
      message: loginThrottledMessage(retryAfterSeconds),
      actions: [FORGOT],
      retryAfterSeconds,
      detail: 'blocked',
    });
  }
}

export function rateLimited(): AppError {
  return new AppError({
    code: ERROR_CODES.RATE_LIMITED,
    httpStatus: 429,
    message: AUTH_ERROR_MESSAGES.RATE_LIMITED,
    actions: [{ kind: 'retry', label: 'Thử lại sau' }],
  });
}

export function accountUnavailable(detail: string): AppError {
  return new AppError({
    code: ERROR_CODES.ACCOUNT_UNAVAILABLE,
    httpStatus: 403,
    message: AUTH_ERROR_MESSAGES.ACCOUNT_UNAVAILABLE,
    actions: [{ kind: 'contact_support', label: 'Liên hệ hỗ trợ' }],
    detail,
  });
}

export function tokenInvalid(purpose: 'verify_email' | 'reset_password'): AppError {
  return new AppError({
    code: ERROR_CODES.TOKEN_INVALID,
    httpStatus: 400,
    message: AUTH_ERROR_MESSAGES.TOKEN_INVALID,
    actions:
      purpose === 'verify_email'
        ? [{ kind: 'resend_verification', label: 'Gửi lại thư' }]
        : [{ kind: 'navigate', label: 'Gửi lại liên kết', href: '/forgot-password' }],
  });
}

export function emailAlreadyVerified(): AppError {
  return new AppError({
    code: ERROR_CODES.EMAIL_ALREADY_VERIFIED,
    httpStatus: 409,
    message: AUTH_ERROR_MESSAGES.EMAIL_ALREADY_VERIFIED,
    actions: [{ kind: 'navigate', label: 'Về trang chủ', href: '/' }],
  });
}

export function ownerRequired(): AppError {
  return new AppError({
    code: ERROR_CODES.OWNER_REQUIRED,
    httpStatus: 409,
    message: AUTH_ERROR_MESSAGES.OWNER_REQUIRED,
    actions: [{ kind: 'fix_input', label: 'Chọn người khác' }],
  });
}

export function seatsFull(): AppError {
  return new AppError({
    code: ERROR_CODES.SEATS_FULL,
    httpStatus: 409,
    message: AUTH_ERROR_MESSAGES.SEATS_FULL,
    actions: [{ kind: 'navigate', label: 'Quản lý thành viên', href: '/settings/members' }],
  });
}

/** Mật khẩu mới không đạt chính sách – lỗi theo ô, mã `PASSWORD_WEAK` ở detail. */
export function passwordWeak(field: string, message: string, reason: string): AppError {
  return new AppError({
    code: ERROR_CODES.VALIDATION_FAILED,
    httpStatus: 400,
    message: 'Thông tin gửi lên chưa đúng. Vui lòng kiểm tra lại các ô được đánh dấu.',
    actions: [{ kind: 'fix_input', label: 'Sửa thông tin' }],
    fieldErrors: [{ path: [field], message }],
    detail: `PASSWORD_WEAK:${reason}`,
  });
}

/** Email sai cú pháp sau chuẩn hóa (hiếm – lược đồ đã kiểm). */
export function emailInvalid(field = 'email'): AppError {
  return new AppError({
    code: ERROR_CODES.VALIDATION_FAILED,
    httpStatus: 400,
    message: 'Thông tin gửi lên chưa đúng. Vui lòng kiểm tra lại các ô được đánh dấu.',
    actions: [{ kind: 'fix_input', label: 'Sửa thông tin' }],
    fieldErrors: [{ path: [field], message: 'Email không hợp lệ.' }],
  });
}
