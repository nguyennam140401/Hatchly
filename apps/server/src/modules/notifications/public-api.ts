import type { NotificationEvent } from '@app/shared/notifications';
import type { Db } from '../../core';

/**
 * Giao diện công khai của module Thông báo (`notifications`) – 005, contracts/notifications.md mục 2.
 *
 * Phát TRONG giao dịch nghiệp vụ hiện tại (`tx` bắt buộc): giao dịch hủy → không có thông báo (FR-042).
 * Không có tham số kênh, người nhận hay khóa chống trùng – Thông báo tự quyết theo danh mục (FR-041, FR-043).
 * Sự kiện sai khuôn hoặc có trường bị cấm (số tiền, mã quyền, nội dung bài…) → NotificationEventInvalidError.
 */
export interface NotificationsPublicApi {
  emit(tx: Db, event: NotificationEvent): Promise<{ status: 'queued' | 'duplicate_pending' }>;
}

/** Token NestJS của NotificationsPublicApi. */
export const NOTIFICATIONS = Symbol('NOTIFICATIONS');

export type { NotificationEvent, NotificationType } from '@app/shared/notifications';
