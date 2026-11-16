// Lỗi nghiệp vụ của bài/duyệt/lịch (012, contracts/http-api.md mục 4). Mỗi lỗi có tiếng Việt đời thường
// và ≥ 1 hành động khắc phục (nguyên tắc VI); mã lỗi gốc chỉ ở "Chi tiết cho hỗ trợ".
import { ERROR_CODES, POST_ERROR_MESSAGES } from '@app/shared/core';
import type { Post, ValidationIssue } from '@app/shared/content';
import { AppError, versionConflict } from '../../../core';

const openPost = (label = 'Mở bài') => ({ kind: 'fix_input', label }) as const;

export function noActiveChannel(): AppError {
  return new AppError({
    code: ERROR_CODES.NO_ACTIVE_CHANNEL,
    httpStatus: 409,
    message: POST_ERROR_MESSAGES.NO_ACTIVE_CHANNEL,
    actions: [{ kind: 'navigate', label: 'Kết nối kênh', href: '/channels' }],
  });
}

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

export function postAlreadyDone(post?: Post | Record<string, unknown>): AppError {
  return new AppError({
    code: ERROR_CODES.POST_ALREADY_APPROVED,
    httpStatus: 409,
    message: POST_ERROR_MESSAGES.POST_ALREADY_APPROVED,
    actions: [openPost()],
    ...(post !== undefined ? { extra: { post } } : {}),
  });
}

export function postContentInvalid(
  channelIssues: { connectionId: string; issues: ValidationIssue[] }[],
  contentIssues: ValidationIssue[] = [],
): AppError {
  return new AppError({
    code: ERROR_CODES.POST_CONTENT_INVALID,
    httpStatus: 422,
    message: POST_ERROR_MESSAGES.POST_CONTENT_INVALID,
    actions: [{ kind: 'fix_input', label: 'Sửa nội dung' }],
    extra: {
      channelIssues: channelIssues.map((c) => ({
        connectionId: c.connectionId,
        code: 'POST_CONTENT_INVALID',
        messageVi: c.issues.map((i) => i.messageVi).join(' '),
        remedies: c.issues.flatMap((i) => i.remedies),
      })),
      contentIssues,
    },
  });
}

export function postVersionConflict(current?: unknown): AppError {
  return versionConflict(
    'Bài vừa được người khác cập nhật. Hãy xem bản mới nhất rồi thử lại.',
    'Xem bản mới',
    current !== undefined ? { post: current } : undefined,
  );
}
