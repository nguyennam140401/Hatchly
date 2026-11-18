import type {
  ApproveRequest,
  BulkResult,
  PendingCountResponse,
  PendingListResponse,
  RescheduleRequest,
  ReturnRequest,
  SuggestTimesResponse,
} from '@app/shared/approval';
import type {
  CalendarResponse,
  ChannelRulesResponse,
  CreatePostRequest,
  Post,
  PostDetailResponse,
  PostHistoryResponse,
  PostListResponse,
  UpdatePostRequest,
} from '@app/shared/content';
import { ChannelConnectionDto } from '@app/shared/platform_gateway';
import { apiClient, type ResponseSchema } from '../client';

// Lời gọi API bài viết, duyệt, lịch (012 contracts/http-api.md). Mọi phản hồi được kiểm các trường cốt lõi bằng lược đồ
// "mở" (id, trạng thái, phiên bản…) rồi mang kiểu đầy đủ của `@app/shared`. Không bao giờ gửi mã tài khoản (từ phiên).
// `expectedVersion` đi trong thân yêu cầu (khóa lạc quan); thời gian là ISO 8601 UTC.

/** Lược đồ "mở": chỉ kiểm các trường cốt lõi có mặt đúng kiểu rồi mang kiểu đầy đủ của `@app/shared` (web không phụ thuộc zod). */
type Check = (value: unknown) => boolean;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str: Check = (v) => typeof v === 'string';
const int: Check = (v) => typeof v === 'number' && Number.isInteger(v);
const arr: Check = Array.isArray;
const shape = <T>(checks: Record<string, Check>): ResponseSchema<T> => ({
  safeParse: (value: unknown) =>
    isObj(value) && Object.entries(checks).every(([key, check]) => check(value[key]))
      ? { success: true as const, data: value as T }
      : { success: false as const },
});

const PostResponse = shape<Post>({ id: str, status: str, version: int });
const DetailResponse = shape<PostDetailResponse>({
  post: (v) => isObj(v) && str(v.id) && int(v.version),
  attempts: arr,
});
const ListResponse = shape<PostListResponse>({ items: arr });
const BulkResponse = shape<BulkResult>({ succeeded: int, failed: int, results: arr });
/**
 * Kết nối ở bộ chọn kênh của trình soạn: KHÔNG có `tiktok` (010 R3 – `channel_variants` chưa hỗ trợ TikTok,
 * đăng TikTok từ trình soạn là tính năng sau). Máy chủ đã lọc; web lọc thêm cho chắc.
 */
export type ComposerChannel = Omit<ChannelConnectionDto, 'channelType'> & {
  channelType: Exclude<ChannelConnectionDto['channelType'], 'tiktok'>;
};
const ChannelsResponse: ResponseSchema<ComposerChannel[]> = {
  safeParse: (value: unknown) => {
    if (!Array.isArray(value)) return { success: false as const };
    const parsed = value.map((v) => ChannelConnectionDto.safeParse(v));
    if (!parsed.every((p) => p.success)) return { success: false as const };
    const data = parsed
      .map((p) => p.data)
      .filter((c): c is ComposerChannel => c !== undefined && c.channelType !== 'tiktok');
    return { success: true as const, data };
  },
};

const P = '/api/v1/posts';

export const postsApi = {
  channels: () => apiClient.request('GET', '/api/v1/channels', { schema: ChannelsResponse }),
  channelRules: () =>
    apiClient.request('GET', '/api/v1/channel-rules', {
      schema: shape<ChannelRulesResponse>({ rules: arr }),
    }),
  create: (body: CreatePostRequest) => apiClient.request('POST', P, { body, schema: PostResponse }),
  get: (id: string) =>
    apiClient.request('GET', `${P}/${encodeURIComponent(id)}`, { schema: DetailResponse }),
  list: (params: { status?: string; q?: string; cursor?: string } = {}) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params))
      if (typeof v === 'string' && v !== '') search.set(k, v);
    const qs = search.toString();
    return apiClient.request('GET', qs === '' ? P : `${P}?${qs}`, { schema: ListResponse });
  },
  save: (id: string, body: UpdatePostRequest) =>
    apiClient.request('PUT', `${P}/${encodeURIComponent(id)}`, { body, schema: PostResponse }),
  remove: (id: string, expectedVersion: number) =>
    apiClient.request(
      'DELETE',
      `${P}/${encodeURIComponent(id)}?expectedVersion=${expectedVersion}`,
    ),
  history: (id: string) =>
    apiClient.request('GET', `${P}/${encodeURIComponent(id)}/history`, {
      schema: shape<PostHistoryResponse>({ events: arr }),
    }),
  submit: (items: { postId: string; expectedVersion: number; scheduledAt?: string }[]) =>
    apiClient.request('POST', `${P}/submit`, { body: { items }, schema: BulkResponse }),
  withdraw: (id: string, expectedVersion: number) =>
    apiClient.request('POST', `${P}/${encodeURIComponent(id)}/withdraw`, {
      body: { expectedVersion },
      schema: PostResponse,
    }),
  approve: (id: string, body: ApproveRequest) =>
    apiClient.request('POST', `${P}/${encodeURIComponent(id)}/approve`, {
      body,
      schema: PostResponse,
    }),
  approveBatch: (items: { postId: string; expectedVersion: number; scheduledAt?: string }[]) =>
    apiClient.request('POST', '/api/v1/approvals/approve-batch', {
      body: { items },
      schema: BulkResponse,
    }),
  returnPost: (id: string, body: ReturnRequest) =>
    apiClient.request('POST', `${P}/${encodeURIComponent(id)}/return`, {
      body,
      schema: PostResponse,
    }),
  returnBatch: (items: { postId: string; expectedVersion: number }[], note: string) =>
    apiClient.request('POST', '/api/v1/approvals/return-batch', {
      body: { items, note },
      schema: BulkResponse,
    }),
  unschedule: (id: string, expectedVersion: number) =>
    apiClient.request('POST', `${P}/${encodeURIComponent(id)}/unschedule`, {
      body: { expectedVersion },
      schema: PostResponse,
    }),
  reschedule: (id: string, body: RescheduleRequest) =>
    apiClient.request('PUT', `${P}/${encodeURIComponent(id)}/schedule`, {
      body,
      schema: PostResponse,
    }),
  suggestTimes: (count: number) =>
    apiClient.request('POST', '/api/v1/approvals/suggest-times', {
      body: { count },
      schema: shape<SuggestTimesResponse>({ times: arr }),
    }),
  pending: (cursor?: string) =>
    apiClient.request(
      'GET',
      cursor === undefined
        ? '/api/v1/approvals/pending?limit=100'
        : `/api/v1/approvals/pending?limit=100&cursor=${encodeURIComponent(cursor)}`,
      { schema: shape<PendingListResponse>({ items: arr }) },
    ),
  pendingCount: () =>
    apiClient.request('GET', '/api/v1/approvals/pending/count', {
      schema: shape<PendingCountResponse>({ count: int }),
    }),
  calendar: (from: string, to: string) =>
    apiClient.request(
      'GET',
      `/api/v1/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { schema: shape<CalendarResponse>({ items: arr }) },
    ),
};
