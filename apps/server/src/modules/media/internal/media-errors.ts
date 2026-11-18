// Dựng `AppError` của thư viện media từ bảng thông điệp dùng chung (`@app/shared/media` MEDIA_ERRORS) – mỗi lỗi
// có thông điệp tiếng Việt đời thường và ít nhất một hành động khắc phục (nguyên tắc VI).
import { MEDIA_ERRORS, type MediaErrorCode } from '@app/shared/media';
import { AppError } from '../../../core';

export function mediaError(
  code: MediaErrorCode,
  options: { extra?: Record<string, unknown>; detail?: string; message?: string } = {},
): AppError {
  const info = MEDIA_ERRORS[code];
  return new AppError({
    code,
    httpStatus: info.httpStatus,
    message: options.message ?? info.message,
    actions: info.actions,
    ...(options.extra !== undefined ? { extra: options.extra } : {}),
    ...(options.detail !== undefined ? { detail: options.detail } : {}),
  });
}

/** Không có / của tài khoản (hoặc người dùng) khác – CÙNG một lỗi, không phân biệt (FR-018). */
export function mediaNotFound(message = 'Tệp này không còn trong thư viện.'): AppError {
  return new AppError({
    code: 'NOT_FOUND',
    httpStatus: 404,
    message,
    actions: [{ kind: 'navigate', label: 'Về thư viện', href: '/media' }],
  });
}
