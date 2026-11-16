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
export type MediaFilter = Readonly<{ kind?: string; q?: string }>;

export const queryKeys = {
  session: { me: () => ['session', 'me'] as const },
  posts: {
    all: () => ['posts'] as const,
    /** Tiền tố để vô hiệu hóa MỌI danh sách bài (`posts.list(*)`). */
    lists: () => ['posts', 'list'] as const,
    list: (filter: PostFilter = {}) => ['posts', 'list', filter] as const,
    detail: (id: string) => ['posts', 'detail', id] as const,
  },
  plan: { current: () => ['plan'] as const },
  channels: { list: () => ['channels', 'list'] as const },
  media: {
    lists: () => ['media', 'list'] as const,
    list: (filter: MediaFilter = {}) => ['media', 'list', filter] as const,
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
