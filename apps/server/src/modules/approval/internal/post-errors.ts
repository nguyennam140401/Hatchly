// Lỗi bài dùng ở `approval` (cùng khuôn với content/internal/post-errors.ts – module không nhập nội bộ của nhau).
import { ERROR_CODES, POST_ERROR_MESSAGES } from '@app/shared/core';
import { AppError, versionConflict } from '../../../core';

const openPost = (label = 'Mở bài') => ({ kind: 'fix_input', label }) as const;

export function postNotFound(): AppError {
  return new AppError({
    code: ERROR_CODES.NOT_FOUND,
    httpStatus: 404,
    message: 'Không tìm thấy bài này.',
    actions: [{ kind: 'navigate', label: 'Về danh sách bài viết', href: '/posts' }],
  });
}

export function postNotEditable(message?: string): AppError {
  return new AppError({
    code: ERROR_CODES.POST_NOT_EDITABLE,
    httpStatus: 409,
    message: message ?? POST_ERROR_MESSAGES.POST_NOT_EDITABLE,
    actions: [{ kind: 'retry', label: 'Tải lại bài' }],
  });
}

export function postAlreadyDone(post?: unknown): AppError {
  return new AppError({
    code: ERROR_CODES.POST_ALREADY_APPROVED,
    httpStatus: 409,
    message: POST_ERROR_MESSAGES.POST_ALREADY_APPROVED,
    actions: [openPost()],
    ...(post !== undefined ? { extra: { post } } : {}),
  });
}

export function postVersionConflict(current?: unknown): AppError {
  return versionConflict(
    'Bài vừa được người khác cập nhật. Hãy xem bản mới nhất rồi thử lại.',
    'Xem bản mới',
    current !== undefined ? { post: current } : undefined,
  );
}
