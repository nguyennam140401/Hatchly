import {
  AUTH_ERROR_MESSAGES,
  authErrorMessage,
  ERROR_CODES,
  loginThrottledMessage,
} from '@app/shared/core';
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

// ----- 009: đăng nhập Google/Facebook, cách đăng nhập, lời mời (contracts/auth-http-api.md mục 8) -----

type Action = AppError['actions'][number];
type Actions = [Action, ...Action[]];

const TO_LOGIN: Action = { kind: 'navigate', label: 'Đăng nhập bằng email', href: '/login' };
const TO_METHODS: Action = {
  kind: 'navigate',
  label: 'Cách đăng nhập',
  href: '/settings/login-methods',
};
const RETRY: Action = { kind: 'retry', label: 'Thử lại' };
const ASK_OWNER: Action = { kind: 'contact_owner', label: 'Nhờ chủ tài khoản gửi lại lời mời' };

const SOCIAL_ERRORS = {
  OAUTH_CANCELLED: { status: 400, actions: [RETRY, TO_LOGIN] },
  OAUTH_FAILED: { status: 400, actions: [RETRY, TO_LOGIN] },
  OAUTH_FLOW_INVALID: {
    status: 400,
    actions: [{ kind: 'navigate', label: 'Bắt đầu lại', href: '/login' }],
  },
  PROVIDER_UNAVAILABLE: { status: 503, actions: [TO_LOGIN] },
  IDENTITY_IN_USE: { status: 409, actions: [TO_METHODS] },
  PROVIDER_ACCOUNT_CONFLICT: { status: 409, actions: [TO_LOGIN] },
  LOGIN_METHOD_EXISTS: { status: 409, actions: [TO_METHODS] },
  LAST_LOGIN_METHOD: { status: 409, actions: [TO_METHODS] },
  REAUTH_REQUIRED: { status: 403, actions: [{ kind: 'reauth', label: 'Xác nhận lại' }] },
  REAUTH_MISMATCH: { status: 400, actions: [RETRY] },
  INVITE_INVALID: { status: 400, actions: [ASK_OWNER] },
  INVITE_EMAIL_MISMATCH: {
    status: 409,
    actions: [
      { kind: 'retry', label: 'Dùng tài khoản khác' },
      { kind: 'contact_owner', label: 'Nhờ chủ tài khoản mời lại bằng email này' },
    ],
  },
  INVITE_EMAIL_IN_USE: {
    status: 409,
    actions: [{ kind: 'contact_owner', label: 'Nhờ chủ tài khoản mời bằng email khác' }],
  },
  INVITE_SELF: { status: 400, actions: [{ kind: 'fix_input', label: 'Nhập email khác' }] },
  ALREADY_IN_ACCOUNT: {
    status: 409,
    actions: [{ kind: 'navigate', label: 'Về trang chủ', href: '/' }],
  },
  SIGNED_REQUEST_INVALID: { status: 400, actions: [RETRY] },
  // Mã sẵn có của 004 – dùng trong `pending.error` của lượt đăng nhập qua nhà cung cấp.
  ACCOUNT_UNAVAILABLE: {
    status: 403,
    actions: [{ kind: 'contact_support', label: 'Liên hệ hỗ trợ' }],
  },
  SEATS_FULL: { status: 409, actions: [ASK_OWNER] },
} as const satisfies Record<string, { status: number; actions: Actions }>;

export type SocialErrorCode = keyof typeof SOCIAL_ERRORS;

export function isSocialErrorCode(code: string): code is SocialErrorCode {
  return Object.hasOwn(SOCIAL_ERRORS, code);
}

export interface SocialErrorVars {
  provider?: 'google' | 'facebook' | undefined;
  /** Email được mời (INVITE_EMAIL_MISMATCH) – của chính lời mời người gọi đang cầm mã. */
  email?: string | undefined;
  /** Mã gốc (nhà cung cấp, CSDL) – chỉ vào `support.detail`. */
  detail?: string | undefined;
}

/** Phần hiển thị của một lỗi – dùng cho `OAuthPendingResponse.error`. */
export function socialErrorView(
  code: SocialErrorCode,
  vars: SocialErrorVars = {},
): { code: string; message: string; actions: Action[] } {
  return {
    code,
    message: authErrorMessage(code, vars),
    actions: [...SOCIAL_ERRORS[code].actions],
  };
}

export function socialError(code: SocialErrorCode, vars: SocialErrorVars = {}): AppError {
  return new AppError({
    code: ERROR_CODES[code],
    httpStatus: SOCIAL_ERRORS[code].status,
    message: authErrorMessage(code, vars),
    actions: [...SOCIAL_ERRORS[code].actions] as Actions,
    ...(vars.detail !== undefined ? { detail: vars.detail } : {}),
  });
}

/** 404 chung của module (mã không thuộc tài khoản này trông giống hệt mã không tồn tại – RLS). */
export function notFound(): AppError {
  return new AppError({
    code: ERROR_CODES.NOT_FOUND,
    httpStatus: 404,
    message: 'Không tìm thấy nội dung bạn yêu cầu.',
    actions: [{ kind: 'navigate', label: 'Về trang chủ', href: '/' }],
  });
}

/** Mã trong thư của lượt đăng nhập qua nhà cung cấp không dùng được (sai, đã dùng, quá hạn). */
export function oauthTokenInvalid(): AppError {
  return new AppError({
    code: ERROR_CODES.TOKEN_INVALID,
    httpStatus: 400,
    message: AUTH_ERROR_MESSAGES.TOKEN_INVALID,
    actions: [{ kind: 'navigate', label: 'Về đăng nhập', href: '/login' }],
  });
}
