import type {
  MarkPublishedResponse,
  PublishProgressView,
  RepublishResponse,
  SupportAttemptDetails,
} from '@app/shared/publishing';
import { apiClient, type ResponseSchema } from '../client';

// Lời gọi API Tiến trình đăng (013 contracts/publishing-http-api.md). Không gửi mã tài khoản (từ phiên). `version` là
// phiên bản của LƯỢT ĐĂNG lúc người dùng xem (khóa lạc quan; lệch → 409 PUBLISH_VERSION_CONFLICT → tải lại).

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const shape = <T>(check: (v: Record<string, unknown>) => boolean): ResponseSchema<T> => ({
  safeParse: (value: unknown) =>
    isObj(value) && check(value)
      ? { success: true as const, data: value as T }
      : { success: false as const },
});

const ProgressResponse = shape<PublishProgressView>(
  (v) => typeof v.postId === 'string' && Array.isArray(v.channels),
);
const RepublishRes = shape<RepublishResponse>((v) => typeof v.attemptId === 'string');
const MarkRes = shape<MarkPublishedResponse>((v) => typeof v.attemptId === 'string');
const SupportRes = shape<SupportAttemptDetails>(
  (v) => typeof v.attemptId === 'string' && typeof v.traceId === 'string',
);

export const publishingApi = {
  progress: (postId: string) =>
    apiClient.request('GET', `/api/v1/posts/${encodeURIComponent(postId)}/publish-progress`, {
      schema: ProgressResponse,
    }),
  republish: (attemptId: string, version: number) =>
    apiClient.request(
      'POST',
      `/api/v1/publish-attempts/${encodeURIComponent(attemptId)}/republish`,
      { body: { version }, schema: RepublishRes },
    ),
  markPublished: (attemptId: string, version: number, permalink?: string) =>
    apiClient.request(
      'POST',
      `/api/v1/publish-attempts/${encodeURIComponent(attemptId)}/mark-published`,
      {
        body: { version, ...(permalink !== undefined && permalink !== '' ? { permalink } : {}) },
        schema: MarkRes,
      },
    ),
  supportDetails: (attemptId: string) =>
    apiClient.request(
      'GET',
      `/api/v1/publish-attempts/${encodeURIComponent(attemptId)}/support-details`,
      { schema: SupportRes },
    ),
};
