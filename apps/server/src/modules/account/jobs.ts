// Loại việc của module Tài khoản & Gói (009, contracts/module-api.md mục 4).
import { z } from 'zod';
import type { Db } from '../../core';
import { defineJobType, defineSchedule, enqueue, type EnqueueResult } from '../queue';

export const MAIL_NOTICE_TEMPLATES = [
  'identity_added',
  'identity_removed',
  'identity_removed_by_provider',
  'identity_link_blocked',
  'invite_accepted',
  'detached_deletion_notice',
] as const;
export type MailNoticeTemplate = (typeof MAIL_NOTICE_TEMPLATES)[number];

/**
 * Thư thông tin KHÔNG mã (cách đăng nhập thay đổi, có người tham gia, sắp bị xóa). Dữ liệu việc chỉ có
 * mã tham chiếu và tên mẫu – không email, tên, mã hay liên kết: bộ xử lý tra người nhận trong tenant.
 */
export const mailNotice = defineJobType({
  name: 'account.mail_notice',
  queue: 'notify',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({
    template: z.enum(MAIL_NOTICE_TEMPLATES),
    /** Người nhận – phải thuộc tài khoản của việc. */
    userId: z.uuid(),
    /** Người được nhắc tới trong thư (vd cộng tác viên vừa tham gia). */
    subjectUserId: z.uuid().optional(),
    /** Cách đăng nhập liên quan. */
    provider: z.enum(['password', 'google', 'facebook']).optional(),
  }),
});

export interface MailNoticeInput {
  template: MailNoticeTemplate;
  userId: string;
  subjectUserId?: string | undefined;
  provider?: 'password' | 'google' | 'facebook' | undefined;
  /** Khóa chống trùng do nơi tạo đặt (vd `account.notice:deletion:{userId}:{detached_at}`). */
  dedupeKey: string;
}

/**
 * Tạo việc gửi thư thông tin TRONG giao dịch tenant `tx` đang mở – việc và dữ liệu nghiệp vụ cùng xác
 * nhận hoặc cùng hoàn tác (nguyên tắc IV, V).
 */
export async function enqueueMailNotice(_tx: Db, input: MailNoticeInput): Promise<EnqueueResult> {
  // `enqueue` dùng giao dịch hiện tại; tham số `_tx` buộc nơi gọi đang ở trong một giao dịch.
  return enqueue(
    mailNotice,
    {
      template: input.template,
      userId: input.userId,
      ...(input.subjectUserId !== undefined ? { subjectUserId: input.subjectUserId } : {}),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
    },
    { dedupeKey: input.dedupeKey },
  );
}

const empty = z.strictObject({});

/** Mỗi 10 phút: hết hạn lời mời, dọn lượt đăng nhập cũ và yêu cầu của Meta quá 12 tháng. */
export const authHousekeeping = defineJobType({
  name: 'account.auth_housekeeping',
  queue: 'scheduled',
  scope: 'system',
  version: 1,
  payload: empty,
});

/** Mỗi giờ: báo trước rồi xóa người ở tài khoản chờ quá hạn (research R18). */
export const detachedUsers = defineJobType({
  name: 'account.detached_users',
  queue: 'scheduled',
  scope: 'system',
  version: 1,
  payload: empty,
});

let schedulesDefined = false;

/** Khai báo lịch của module (Worker, lúc khởi động). Gọi lại nhiều lần an toàn. */
export function defineAccountSchedules(): void {
  if (schedulesDefined) return;
  schedulesDefined = true;
  defineSchedule({
    name: 'account.auth_housekeeping',
    cron: '*/10 * * * *',
    tz: 'UTC',
    jobType: authHousekeeping,
  });
  defineSchedule({
    name: 'account.detached_users',
    cron: '7 * * * *',
    tz: 'UTC',
    jobType: detachedUsers,
  });
}
