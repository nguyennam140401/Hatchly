import {
  CompleteUploadResponse,
  ListResponse,
  MediaDetail,
  PartUrlsResponse,
  Quota,
  StartUploadResponse,
  UploadStatusResponse,
  UsagesResponse,
  type ListQuery,
  type StartUploadBody,
} from '@app/shared/media';
import { apiClient } from '../client';

// Lời gọi API thư viện media (014 contracts/media-http-api.md) – mọi phản hồi kiểm bằng lược đồ dùng chung
// `@app/shared/media`; lỗi thành AppError (thông điệp + hành động của máy chủ). Không bao giờ gửi mã tài khoản.
// Tệp KHÔNG đi qua đây: tải thẳng lên kho bằng đường dẫn ký sẵn (lib/upload).

const M = '/api/v1/media';
const U = '/api/v1/media/uploads';

export type MediaListParams = Partial<Omit<ListQuery, 'limit'>> & { limit?: number };

function queryString(params: MediaListParams): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value));
  }
  const text = qs.toString();
  return text === '' ? '' : `?${text}`;
}

export const mediaApi = {
  list: (params: MediaListParams = {}, signal?: AbortSignal) =>
    apiClient.request('GET', `${M}${queryString(params)}`, {
      schema: ListResponse,
      ...(signal !== undefined ? { signal } : {}),
    }),
  quota: () => apiClient.request('GET', `${M}/quota`, { schema: Quota }),
  get: (mediaId: string) =>
    apiClient.request('GET', `${M}/${encodeURIComponent(mediaId)}`, { schema: MediaDetail }),
  usages: (mediaId: string) =>
    apiClient.request('GET', `${M}/${encodeURIComponent(mediaId)}/usages`, {
      schema: UsagesResponse,
    }),
  remove: (mediaId: string, confirm = false) =>
    apiClient.request(
      'DELETE',
      `${M}/${encodeURIComponent(mediaId)}${confirm ? '?confirm=true' : ''}`,
    ),

  // ----- tải lên -----
  startUpload: (body: StartUploadBody, signal?: AbortSignal) =>
    apiClient.request('POST', U, {
      body,
      schema: StartUploadResponse,
      ...(signal !== undefined ? { signal } : {}),
    }),
  partUrls: (uploadId: string, partNumbers: readonly number[], signal?: AbortSignal) =>
    apiClient.request('POST', `${U}/${encodeURIComponent(uploadId)}/part-urls`, {
      body: { partNumbers },
      schema: PartUrlsResponse,
      ...(signal !== undefined ? { signal } : {}),
    }),
  completeUpload: (uploadId: string, signal?: AbortSignal) =>
    apiClient.request('POST', `${U}/${encodeURIComponent(uploadId)}/complete`, {
      schema: CompleteUploadResponse,
      ...(signal !== undefined ? { signal } : {}),
    }),
  uploadStatus: (uploadId: string, signal?: AbortSignal) =>
    apiClient.request('GET', `${U}/${encodeURIComponent(uploadId)}`, {
      schema: UploadStatusResponse,
      ...(signal !== undefined ? { signal } : {}),
    }),
  cancelUpload: (uploadId: string) =>
    apiClient.request('DELETE', `${U}/${encodeURIComponent(uploadId)}`),
};
