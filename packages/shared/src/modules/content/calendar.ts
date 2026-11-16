// Lịch tuần/tháng (012, contracts/http-api.md): truy vấn theo khoảng giờ UTC, tối đa 42 ngày.
import { z } from 'zod';
import type { AttemptStatus, ChannelType, PostLabels, PostStatus } from './post.js';

export const CALENDAR_MAX_DAYS = 42;

export const CalendarQuery = z
  .strictObject({ from: z.iso.datetime(), to: z.iso.datetime() })
  .superRefine((v, ctx) => {
    const from = Date.parse(v.from);
    const to = Date.parse(v.to);
    if (!(to > from)) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Ngày kết thúc phải sau ngày bắt đầu.',
      });
    } else if (to - from > CALENDAR_MAX_DAYS * 86_400_000) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `Chỉ xem được tối đa ${CALENDAR_MAX_DAYS} ngày mỗi lần.`,
      });
    }
  });
export type CalendarQuery = z.infer<typeof CalendarQuery>;

export interface CalendarChannel {
  channelType: ChannelType;
  displayName: string | null;
  attemptStatus: AttemptStatus | null;
}

export interface CalendarItem {
  postId: string;
  title: string;
  scheduledAt: string;
  status: PostStatus;
  version: number;
  labels: PostLabels;
  channels: CalendarChannel[];
  /** true khi bài đã duyệt và mọi mục còn `scheduled`, hoặc bài chưa duyệt (chỉ đổi giờ dự kiến). */
  movable: boolean;
  movableReason: string | null;
}

export interface CalendarResponse {
  items: CalendarItem[];
}
