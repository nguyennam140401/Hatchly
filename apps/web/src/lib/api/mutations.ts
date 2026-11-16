import type { ApiMutationResult } from './hooks';
import { useApiMutation, type Optimistic, type OptimisticOperation } from './hooks';
import { queryKeys, type QueryKey } from './query-keys';

// MA TRẬN VÔ HIỆU HÓA (contracts/data-layer.md mục 3, SC-005): mỗi thao tác ghi khai báo các khóa cần làm mới ở MỘT bảng
// duy nhất. Tính năng sau thêm hàng khi thêm thao tác (cùng PR); kiểm thử `mutations.spec.ts` chặn việc quên.

export interface MutationSpec<V, R, Op extends string> {
  operation: Op;
  /** Khóa làm mới sau khi máy chủ xác nhận. */
  invalidates: (vars: V, result: R) => QueryKey[];
  /** Thao tác làm đổi số đếm – bảng kiểm thử bắt buộc `invalidates` chứa khóa đếm tương ứng. */
  changes?: readonly ('pendingReview' | 'unread' | 'usage')[];
}

function define<V, R, Op extends string>(spec: MutationSpec<V, R, Op>): MutationSpec<V, R, Op> {
  return spec;
}

interface IdVars {
  id: string;
}

export const MUTATIONS = {
  // 012: soạn bài tay, gửi duyệt, rút lại.
  createPost: define<unknown, unknown, 'createPost'>({
    operation: 'createPost',
    invalidates: () => [
      queryKeys.posts.lists(),
      queryKeys.calendar.all(),
      queryKeys.overview.all(),
    ],
  }),
  submitPosts: define<unknown, unknown, 'submitPosts'>({
    operation: 'submitPosts',
    changes: ['pendingReview'],
    invalidates: () => [
      queryKeys.posts.all(),
      queryKeys.calendar.all(),
      queryKeys.counters.pendingReview(),
      queryKeys.overview.all(),
    ],
  }),
  withdrawPost: define<IdVars, unknown, 'withdrawPost'>({
    operation: 'withdrawPost',
    changes: ['pendingReview'],
    invalidates: ({ id }) => [
      queryKeys.posts.detail(id),
      queryKeys.posts.lists(),
      queryKeys.counters.pendingReview(),
    ],
  }),
  deleteDraft: define<IdVars, unknown, 'deleteDraft'>({
    operation: 'deleteDraft',
    invalidates: ({ id }) => [
      queryKeys.posts.detail(id),
      queryKeys.posts.lists(),
      queryKeys.calendar.all(),
      queryKeys.overview.all(),
    ],
  }),
  approvePosts: define<unknown, unknown, 'approvePosts'>({
    operation: 'approvePosts',
    changes: ['pendingReview', 'unread'],
    invalidates: () => [
      queryKeys.approvals.pending(),
      queryKeys.posts.all(),
      queryKeys.calendar.all(),
      queryKeys.counters.pendingReview(),
      queryKeys.overview.all(),
      queryKeys.notifications.unread(),
    ],
  }),
  returnPosts: define<unknown, unknown, 'returnPosts'>({
    operation: 'returnPosts',
    changes: ['pendingReview', 'unread'],
    invalidates: () => [
      queryKeys.approvals.pending(),
      queryKeys.posts.all(),
      queryKeys.counters.pendingReview(),
      queryKeys.overview.all(),
      queryKeys.notifications.unread(),
    ],
  }),
  approvePost: define<IdVars, unknown, 'approvePost'>({
    operation: 'approvePost',
    changes: ['pendingReview', 'unread'],
    invalidates: ({ id }) => [
      queryKeys.posts.detail(id),
      queryKeys.posts.lists(),
      queryKeys.counters.pendingReview(),
      queryKeys.overview.all(),
      queryKeys.notifications.unread(),
    ],
  }),
  returnPost: define<IdVars, unknown, 'returnPost'>({
    operation: 'returnPost',
    changes: ['pendingReview', 'unread'],
    invalidates: ({ id }) => [
      queryKeys.posts.detail(id),
      queryKeys.posts.lists(),
      queryKeys.counters.pendingReview(),
      queryKeys.overview.all(),
      queryKeys.notifications.unread(),
    ],
  }),
  cancelPost: define<IdVars, unknown, 'cancelPost'>({
    operation: 'cancelPost',
    changes: ['pendingReview', 'unread'],
    invalidates: ({ id }) => [
      queryKeys.posts.detail(id),
      queryKeys.posts.lists(),
      queryKeys.counters.pendingReview(),
      queryKeys.overview.all(),
      queryKeys.notifications.unread(),
    ],
  }),
  reschedule: define<IdVars, unknown, 'reschedule'>({
    operation: 'reschedule',
    invalidates: ({ id }) => [
      queryKeys.posts.detail(id),
      queryKeys.posts.lists(),
      queryKeys.calendar.all(),
    ],
  }),
  editPostContent: define<IdVars, unknown, 'editPostContent'>({
    operation: 'editPostContent',
    changes: ['pendingReview'],
    invalidates: ({ id }) => [
      queryKeys.posts.detail(id),
      queryKeys.posts.lists(),
      queryKeys.counters.pendingReview(),
    ],
  }),
  republishPost: define<IdVars, unknown, 'republishPost'>({
    operation: 'republishPost',
    changes: ['usage', 'unread'],
    invalidates: ({ id }) => [
      queryKeys.posts.detail(id),
      queryKeys.posts.lists(),
      queryKeys.usage.current(),
      queryKeys.notifications.unread(),
    ],
  }),
  markPostPublished: define<IdVars, unknown, 'markPostPublished'>({
    operation: 'markPostPublished',
    changes: ['usage', 'unread'],
    invalidates: ({ id }) => [
      queryKeys.posts.detail(id),
      queryKeys.posts.lists(),
      queryKeys.usage.current(),
      queryKeys.notifications.unread(),
    ],
  }),
  connectChannel: define<unknown, unknown, 'connectChannel'>({
    operation: 'connectChannel',
    invalidates: () => [
      queryKeys.channels.list(),
      queryKeys.overview.all(),
      queryKeys.posts.lists(),
    ],
  }),
  disconnectChannel: define<unknown, unknown, 'disconnectChannel'>({
    operation: 'disconnectChannel',
    invalidates: () => [
      queryKeys.channels.list(),
      queryKeys.overview.all(),
      queryKeys.posts.lists(),
    ],
  }),
  uploadMedia: define<unknown, unknown, 'uploadMedia'>({
    operation: 'uploadMedia',
    changes: ['usage'],
    invalidates: () => [queryKeys.media.lists(), queryKeys.usage.current()],
  }),
  deleteMedia: define<unknown, unknown, 'deleteMedia'>({
    operation: 'deleteMedia',
    changes: ['usage'],
    invalidates: () => [queryKeys.media.lists(), queryKeys.usage.current()],
  }),
  saveProfile: define<unknown, unknown, 'saveProfile'>({
    operation: 'saveProfile',
    invalidates: () => [queryKeys.profile.current(), queryKeys.profile.versions()],
  }),
  inviteMember: define<unknown, unknown, 'inviteMember'>({
    operation: 'inviteMember',
    invalidates: () => [queryKeys.members.list(), queryKeys.session.me()],
  }),
  removeMember: define<unknown, unknown, 'removeMember'>({
    operation: 'removeMember',
    invalidates: () => [queryKeys.members.list(), queryKeys.session.me()],
  }),
  markRead: define<unknown, unknown, 'markRead'>({
    operation: 'markRead',
    changes: ['unread'],
    invalidates: () => [queryKeys.notifications.list(), queryKeys.notifications.unread()],
  }),
  bulkCreatePosts: define<unknown, { jobId?: string } | undefined, 'bulkCreatePosts'>({
    operation: 'bulkCreatePosts',
    changes: ['usage'],
    invalidates: (_vars, result) => [
      queryKeys.posts.lists(),
      queryKeys.usage.current(),
      ...(result?.jobId !== undefined ? [queryKeys.jobs.detail(result.jobId)] : []),
    ],
  }),
} as const;

export type MutationName = keyof typeof MUTATIONS;

/** Khóa đếm mà một giá trị `changes` phải kéo theo. */
export const COUNTER_KEY: Record<'pendingReview' | 'unread' | 'usage', QueryKey> = {
  pendingReview: queryKeys.counters.pendingReview(),
  unread: queryKeys.notifications.unread(),
  usage: queryKeys.usage.current(),
};

/** Dùng một thao tác đã khai báo trong `MUTATIONS` (làm mới đúng bảng, không tự liệt kê khóa ở màn hình). */
export function useMutationOf<V, R, Op extends string>(
  spec: MutationSpec<V, R, Op>,
  fn: (vars: V) => Promise<R>,
  optimistic?: Op extends OptimisticOperation ? Optimistic<V> : never,
): ApiMutationResult<V, R> {
  return useApiMutation<V, R, Op>({
    operation: spec.operation,
    fn,
    invalidates: spec.invalidates,
    ...(optimistic !== undefined ? { optimistic } : {}),
  });
}
