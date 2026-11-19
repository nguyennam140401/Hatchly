// Nhà máy khóa truy vấn (kiểu chặt). KHÔNG có tham số `accountId`: ngữ cảnh tài khoản đến từ phiên; QueryClient được
// tạo mới theo phiên và `clear()` khi đổi người (FR-010, data-model mục 4).

export type QueryKey = readonly unknown[];

export type PostFilter = Readonly<{
  status?: string;
  channel?: string;
  from?: string;
  to?: string;
  q?: string;
}>;
export type MediaFilter = Readonly<{
  kind?: string | undefined;
  q?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  /** Con trỏ trang tiếp (014 – "Xem thêm"). */
  cursor?: string | undefined;
}>;

export const queryKeys = {
  session: { me: () => ['session', 'me'] as const },
  posts: {
    all: () => ['posts'] as const,
    /** Tiền tố để vô hiệu hóa MỌI danh sách bài (`posts.list(*)`). */
    lists: () => ['posts', 'list'] as const,
    list: (filter: PostFilter = {}) => ['posts', 'list', filter] as const,
    detail: (id: string) => ['posts', 'detail', id] as const,
  },
  /** 013: Tiến trình đăng của một bài (theo kênh, 5 bước). */
  publishing: {
    progress: (postId: string) => ['publishing', 'progress', postId] as const,
    support: (attemptId: string) => ['publishing', 'support', attemptId] as const,
  },
  /** 012: danh sách Chờ duyệt của chủ tài khoản. */
  approvals: { pending: () => ['approvals', 'pending'] as const },
  plan: { current: () => ['plan'] as const },
  channels: {
    list: () => ['channels', 'list'] as const,
    /** 010: màn hình "Kênh kết nối" – chỉ đọc dữ liệu đã lưu; cũng nuôi dấu chỉ báo ở menu (FR-026). */
    overview: () => ['channels', 'overview'] as const,
    selection: (selectionId: string) => ['channels', 'selection', selectionId] as const,
    disconnectPreview: (connectionId: string) =>
      ['channels', 'disconnect-preview', connectionId] as const,
  },
  media: {
    lists: () => ['media', 'list'] as const,
    list: (filter: MediaFilter = {}) => ['media', 'list', filter] as const,
    detail: (id: string) => ['media', 'detail', id] as const,
    usages: (id: string) => ['media', 'usages', id] as const,
  },
  profile: {
    current: () => ['profile', 'current'] as const,
    versions: () => ['profile', 'versions'] as const,
  },
  members: { list: () => ['members', 'list'] as const },
  usage: { current: () => ['usage', 'current'] as const },
  notifications: {
    list: () => ['notifications', 'list'] as const,
    unread: () => ['notifications', 'unread'] as const,
  },
  jobs: { detail: (jobId: string) => ['jobs', 'detail', jobId] as const },
  counters: { pendingReview: () => ['counters', 'pendingReview'] as const },
  overview: { all: () => ['overview'] as const, summary: () => ['overview', 'summary'] as const },
  calendar: {
    all: () => ['calendar'] as const,
    range: (from: string, to: string) => ['calendar', from, to] as const,
  },
} as const;
