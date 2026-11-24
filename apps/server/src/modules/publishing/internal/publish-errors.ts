// Lỗi nghiệp vụ của Tiến trình đăng (013 contracts/publishing-http-api.md mục 5). Tiếng Việt đời thường, ≥ 1 hành động.
import { ERROR_CODES, POST_ERROR_MESSAGES } from '@app/shared/core';
import { AppError } from '../../../core';

const reload = { kind: 'retry', label: 'Tải lại trang' } as const;

export function attemptNotFound(): AppError {
  return new AppError({
    code: ERROR_CODES.PUBLISH_ATTEMPT_NOT_FOUND,
    httpStatus: 404,
    message: POST_ERROR_MESSAGES.PUBLISH_ATTEMPT_NOT_FOUND,
    actions: [{ kind: 'navigate', label: 'Về danh sách bài viết', href: '/posts' }],
  });
}

export function notRepublishable(): AppError {
  return new AppError({
    code: ERROR_CODES.PUBLISH_NOT_REPUBLISHABLE,
    httpStatus: 409,
    message: POST_ERROR_MESSAGES.PUBLISH_NOT_REPUBLISHABLE,
    actions: [reload],
  });
}

export function notCheckable(): AppError {
  return new AppError({
    code: ERROR_CODES.PUBLISH_NOT_CHECKABLE,
    httpStatus: 409,
    message: POST_ERROR_MESSAGES.PUBLISH_NOT_CHECKABLE,
    actions: [reload],
  });
}

/** Khóa việc `publish:{id}` còn việc hiệu lực: từ chối "Đăng lại" (giao dịch hoàn tác), không để lượt treo. */
export function publishJobBusy(): AppError {
  return new AppError({
    code: ERROR_CODES.PUBLISH_VERSION_CONFLICT,
    httpStatus: 409,
    message: 'Bài đang được xử lý, thử lại sau ít giây',
    actions: [{ kind: 'retry', label: 'Thử lại' }],
  });
}

export function publishVersionConflict(): AppError {
  return new AppError({
    code: ERROR_CODES.PUBLISH_VERSION_CONFLICT,
    httpStatus: 409,
    message: POST_ERROR_MESSAGES.PUBLISH_VERSION_CONFLICT,
    actions: [reload],
  });
}
