// Lỗi nghiệp vụ của duyệt & lịch (012 contracts/http-api.md mục 4). Tiếng Việt đời thường, ≥ 1 hành động.
import { ERROR_CODES, POST_ERROR_MESSAGES } from '@app/shared/core';
import type { ChannelIssue } from '@app/shared/approval';
import type { ValidationIssue } from '@app/shared/content';
import { AppError } from '../../../core';

export function timeInPast(suggestedAt: Date | null, minLeadMinutes: number): AppError {
  return new AppError({
    code: ERROR_CODES.TIME_IN_PAST,
    httpStatus: 422,
    message: `Giờ đăng đã qua hoặc quá gần. Hãy chọn giờ muộn hơn ít nhất ${minLeadMinutes} phút.`,
    actions: [
      { kind: 'fix_input', label: suggestedAt === null ? 'Chọn giờ khác' : 'Dùng giờ gợi ý' },
    ],
    ...(suggestedAt !== null ? { extra: { suggestedAt: suggestedAt.toISOString() } } : {}),
  });
}

/** Một phản hồi gom MỌI kênh vướng để giao diện hiện đủ cùng lúc (tất cả hoặc không). */
export function channelIssuesError(
  code: 'CHANNEL_INACTIVE' | 'CHANNEL_QUOTA_EXCEEDED' | 'CHANNEL_ALREADY_PUBLISHING',
  issues: ChannelIssue[],
): AppError {
  const status = 409;
  return new AppError({
    code: ERROR_CODES[code],
    httpStatus: status,
    message: POST_ERROR_MESSAGES[code],
    actions: [
      code === 'CHANNEL_INACTIVE'
        ? { kind: 'navigate', label: 'Kết nối lại', href: '/channels' }
        : code === 'CHANNEL_ALREADY_PUBLISHING'
          ? { kind: 'navigate', label: 'Xem tiến trình', href: '/posts' }
          : { kind: 'fix_input', label: 'Chọn giờ khác' },
    ],
    extra: { channelIssues: issues },
  });
}

export function planExpired(): AppError {
  return new AppError({
    code: ERROR_CODES.PLAN_EXPIRED,
    httpStatus: 403,
    message: POST_ERROR_MESSAGES.PLAN_EXPIRED,
    actions: [{ kind: 'navigate', label: 'Gia hạn gói', href: '/plan' }],
  });
}

export function returnNoteRequired(): AppError {
  return new AppError({
    code: ERROR_CODES.RETURN_NOTE_REQUIRED,
    httpStatus: 422,
    message: POST_ERROR_MESSAGES.RETURN_NOTE_REQUIRED,
    actions: [{ kind: 'fix_input', label: 'Nhập ghi chú' }],
  });
}

export function bulkLimitExceeded(limit: number): AppError {
  return new AppError({
    code: ERROR_CODES.BULK_LIMIT_EXCEEDED,
    httpStatus: 422,
    message: `Mỗi lần chỉ xử lý tối đa ${limit} bài. Hãy chia nhỏ lựa chọn.`,
    actions: [{ kind: 'fix_input', label: 'Chia nhỏ lựa chọn' }],
  });
}

export function onlySubmitterCanWithdraw(): AppError {
  return new AppError({
    code: ERROR_CODES.FORBIDDEN,
    httpStatus: 403,
    message: 'Chỉ người đã gửi duyệt mới rút lại được bài này.',
    actions: [{ kind: 'contact_owner', label: 'Nhờ người gửi duyệt' }],
  });
}

export function timeAndContentTogether(): AppError {
  return new AppError({
    code: ERROR_CODES.VALIDATION_FAILED,
    httpStatus: 422,
    message:
      'Không thể vừa sửa nội dung vừa đổi giờ cùng lúc ở bài đã duyệt. Hãy lưu nội dung trước, rồi đổi giờ sau.',
    actions: [{ kind: 'fix_input', label: 'Sửa lại' }],
  });
}

export function missingScheduleTime(): AppError {
  return new AppError({
    code: ERROR_CODES.VALIDATION_FAILED,
    httpStatus: 422,
    message: 'Bài chưa có giờ đăng. Hãy chọn giờ đăng trước khi duyệt.',
    actions: [{ kind: 'fix_input', label: 'Chọn giờ đăng' }],
    fieldErrors: [{ path: ['scheduledAt'], message: 'Hãy chọn giờ đăng.' }],
  });
}

/** Nội dung vượt giới hạn kênh / thiếu media / bài rỗng (422), kèm danh sách kênh vướng. */
export function contentInvalidError(
  channelIssues: { connectionId: string; issues: ValidationIssue[] }[],
  contentIssues: ValidationIssue[],
): AppError {
  const inactive = channelIssues.some((c) => c.issues.some((i) => i.rule === 'channel_inactive'));
  const issues: ChannelIssue[] = channelIssues.map((c) => ({
    connectionId: c.connectionId,
    code: c.issues.some((i) => i.rule === 'channel_inactive')
      ? 'CHANNEL_INACTIVE'
      : 'POST_CONTENT_INVALID',
    messageVi: c.issues.map((i) => i.messageVi).join(' '),
    remedies: c.issues.flatMap((i) => i.remedies).length
      ? (c.issues.flatMap((i) => i.remedies) as ChannelIssue['remedies'])
      : [{ action: 'edit_text', labelVi: 'Sửa nội dung' }],
  }));
  if (inactive) return channelIssuesError('CHANNEL_INACTIVE', issues);
  return new AppError({
    code: ERROR_CODES.POST_CONTENT_INVALID,
    httpStatus: 422,
    message: POST_ERROR_MESSAGES.POST_CONTENT_INVALID,
    actions: [{ kind: 'fix_input', label: 'Sửa nội dung' }],
    extra: { channelIssues: issues, contentIssues },
  });
}
