import {
  NOTIFICATION_RULES,
  type NotificationAction,
  type NotificationEvent,
  type NotificationType,
} from '@app/shared/notifications';

// Mẫu tiếng Việt đời thường cho 10 loại thông báo (005, contracts/notifications.md mục 4.6). Chỉ dùng
// `postTitle` ngắn và tên kênh; KHÔNG nội dung bài, KHÔNG số tiền (chỉ %). Luôn ≥ 1 hành động.

export interface RenderedNotification {
  titleVi: string;
  bodyVi: string;
  actions: { kind: NotificationAction['kind']; targetId?: string; labelVi: string; url: string }[];
}

const LABELS: Record<NotificationAction['kind'], string> = {
  open_post: 'Mở bài',
  open_attempt: 'Xem lượt đăng',
  reconnect_channel: 'Kết nối lại kênh',
  open_usage: 'Xem mức dùng AI',
  open_plan: 'Xem gói dịch vụ',
};

const PATHS: Record<NotificationAction['kind'], (id?: string) => string> = {
  open_post: (id) => `/posts/${id ?? ''}`,
  // 013: đích là MÃ BÀI (refs.postId được ưu tiên) → màn hình Tiến trình đăng của bài.
  open_attempt: (id) => `/posts/${id ?? ''}/progress`,
  reconnect_channel: (id) => `/channels${id === undefined ? '' : `/${id}`}`,
  open_usage: () => '/settings/ai-usage',
  open_plan: (id) => `/plans${id === undefined ? '' : `/${id}`}`,
};

const quote = (t: string | undefined) => (t === undefined ? 'bài viết' : `"${t}"`);

function text(event: NotificationEvent): { titleVi: string; bodyVi: string } {
  const p = event.params ?? {};
  const t: Record<NotificationType, () => { titleVi: string; bodyVi: string }> = {
    post_pending_review: () => ({
      titleVi: 'Có bài chờ bạn duyệt',
      bodyVi: `Cộng tác viên vừa gửi ${event.type === 'post_pending_review' ? event.refs.postIds.length : 1} bài chờ duyệt. Mở để xem và duyệt.`,
    }),
    post_returned: () => ({
      titleVi: 'Bài được trả lại để sửa',
      bodyVi: `Chủ tài khoản đã trả lại ${quote(p.postTitle)} để bạn chỉnh sửa.`,
    }),
    approved_post_rescheduled: () => ({
      titleVi: 'Bài đã duyệt được đổi giờ đăng',
      bodyVi: `Giờ đăng của ${quote(p.postTitle)} vừa được thay đổi. Bài không cần duyệt lại.`,
    }),
    batch_generation_done: () => ({
      titleVi: 'Đã tạo xong các bài nháp',
      bodyVi: 'AI đã tạo xong loạt bài nháp bạn yêu cầu. Mở kế hoạch để xem và sửa.',
    }),
    publish_needs_action: () => {
      const refs = event.type === 'publish_needs_action' ? event.refs : undefined;
      const channel = p.channelDisplayName ?? 'kênh';
      if (refs?.state === 'needs_check') {
        return {
          titleVi: 'Bài cần bạn kiểm tra',
          bodyVi: `Chưa rõ ${quote(p.postTitle)} đã lên ${channel} hay chưa. Hãy kiểm tra trên trang rồi chọn "Đã đăng" hoặc "Đăng lại".`,
        };
      }
      const tail =
        refs?.reason === 'overdue'
          ? 'Bài đã quá giờ hẹn nên chưa đăng. Mở lượt đăng để đăng lại.'
          : refs?.reason === 'retries_exhausted'
            ? 'Hệ thống đã thử lại nhiều lần nhưng chưa được. Mở lượt đăng để xem cách khắc phục.'
            : 'Mở lượt đăng để xem cách khắc phục.';
      return {
        titleVi: 'Bài chưa đăng được',
        bodyVi: `${quote(p.postTitle)} chưa đăng được lên ${channel}. ${tail}`,
      };
    },
    channel_token_expiring: () => {
      const stage = event.type === 'channel_token_expiring' ? event.refs.stage : undefined;
      const channel = p.channelDisplayName ?? 'kênh';
      if (stage === 'expired') {
        return {
          titleVi: 'Kết nối kênh đã hết hạn',
          bodyVi: `Quyền đăng bài lên ${channel} đã hết hạn nên bài hẹn giờ sẽ không đăng được. Kết nối lại để tiếp tục.`,
        };
      }
      const when = stage === 'd1' ? 'chỉ còn 1 ngày là' : 'sắp';
      return {
        titleVi: 'Kết nối kênh sắp hết hạn',
        bodyVi: `Quyền đăng bài lên ${channel} ${when} hết hạn. Kết nối lại để bài hẹn giờ vẫn đăng được.`,
      };
    },
    channel_needs_reconnect: () => {
      const reason = event.type === 'channel_needs_reconnect' ? event.refs.reason : undefined;
      const channel = p.channelDisplayName ?? 'kênh';
      const why =
        reason === 'token_revoked'
          ? 'Quyền đăng bài đã bị thu hồi trên nền tảng'
          : reason === 'scope_missing'
            ? 'Ứng dụng đang thiếu một số quyền cần thiết'
            : reason === 'source_page_lost'
              ? 'Page liên kết với kênh này không còn dùng được'
              : reason === 'not_eligible'
                ? 'Tài khoản chưa đủ điều kiện để đăng bài'
                : 'Quyền đăng bài đã hết hạn';
      const impact =
        p.affectedPosts !== undefined && p.affectedPosts > 0
          ? ` ${p.affectedPosts} bài đã lên lịch sẽ không đăng được cho đến khi bạn kết nối lại.`
          : '';
      return {
        titleVi: 'Kênh cần kết nối lại',
        bodyVi: `${why} (${channel}).${impact} Hãy kết nối lại để tiếp tục đăng bài.`,
      };
    },
    ai_usage_80: () => ({
      titleVi: 'Bạn đã dùng 80% giới hạn AI của chu kỳ',
      bodyVi:
        'Khi dùng hết, các chức năng AI tạm dừng đến chu kỳ sau. Bạn vẫn soạn, duyệt và đăng bài bình thường.',
    }),
    ai_usage_100: () => ({
      titleVi: 'Đã dùng hết giới hạn AI của chu kỳ',
      bodyVi:
        'Các chức năng AI tạm dừng đến chu kỳ sau. Bạn vẫn soạn tay, duyệt, lên lịch và đăng bài bình thường.',
    }),
    plan_expiring: () => ({
      titleVi: 'Gói dịch vụ sắp hết hạn',
      bodyVi: 'Gói của bạn sắp hết hạn. Gia hạn để không gián đoạn việc đăng bài.',
    }),
    data_deletion_scheduled: () => ({
      titleVi: 'Dữ liệu sắp bị xóa',
      bodyVi: 'Dữ liệu tài khoản đã được lên lịch xóa. Liên hệ hỗ trợ nếu đây là nhầm lẫn.',
    }),
  };
  return t[event.type]();
}

/** Hành động mặc định của loại + hành động của bên phát (trùng loại → lấy của bên phát). */
function actionsOf(event: NotificationEvent): NotificationAction[] {
  if (event.actions !== undefined && event.actions.length > 0) return event.actions;
  const refs = event.refs as Record<string, unknown>;
  const target =
    (refs.postId as string | undefined) ??
    (refs.attemptId as string | undefined) ??
    (refs.connectionId as string | undefined) ??
    (refs.planId as string | undefined);
  return NOTIFICATION_RULES[event.type].defaultActions.map((kind) => ({
    kind,
    ...(target !== undefined && kind !== 'open_usage' ? { targetId: target } : {}),
  }));
}

export function render(event: NotificationEvent, webBaseUrl: string): RenderedNotification {
  return {
    ...text(event),
    actions: actionsOf(event).map((a) => ({
      kind: a.kind,
      ...(a.targetId !== undefined ? { targetId: a.targetId } : {}),
      labelVi: LABELS[a.kind],
      url: `${webBaseUrl}${PATHS[a.kind](a.targetId)}`,
    })),
  };
}
