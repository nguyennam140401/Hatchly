import type { StartUploadResponse } from '@app/shared/media';
import { mediaApi } from '../../lib/api/endpoints/media';
import { AppError, isAppError } from '../../lib/api/errors';
import { postFormToStorage } from '../../lib/upload/transports/post';
import { uploadMissingParts } from '../../lib/upload/transports/multipart';
import {
  UploadError,
  type UploadOutcome,
  type UploadSession,
  type UploadTransport,
} from '../../lib/upload/transports/types';
import { resolveContentType } from '../../lib/upload/validate';
import { fingerprintOf } from './fingerprint';

// Nối hàng đợi tải (011) với API thư viện media (014 contracts/media-ui.md mục 5):
//   kiểm cục bộ (hàng đợi) → fingerprint → POST /media/uploads → tải THẲNG lên kho (single: POST ký sẵn; multipart: PUT từng phần,
//   bỏ qua phần đã có) → POST …/complete → hỏi GET …/uploads/:id tới khi xử lý xong hoặc trùng.
// Mã phiên, đường dẫn ký sẵn, `fields` chỉ nằm trong bộ nhớ của hàng đợi (không lưu cục bộ, không ghi nhật ký).

const POLL_FIRST_MS = 2000;
const POLL_MAX_MS = 10_000;
const POLL_TIMEOUT_MS = 10 * 60_000;

/** Lỗi API → lỗi tải có phân loại để hàng đợi quyết định (hết chỗ, gói hết hạn, thử lại, dừng). */
export function toUploadError(error: unknown): unknown {
  if (!isAppError(error)) return error;
  switch (error.code) {
    case 'MEDIA_QUOTA_EXCEEDED':
      return new UploadError(error.message, 'storage_full');
    case 'MEDIA_PLAN_EXPIRED':
      return new UploadError(error.message, 'plan_expired');
    case 'UPLOAD_INCOMPLETE':
      return new UploadError(error.message, 'retryable');
    case 'MEDIA_TYPE_UNSUPPORTED':
    case 'MEDIA_TOO_LARGE':
    case 'UPLOAD_REJECTED':
      return new UploadError(error.message, 'fatal');
  }
  return error.kind === 'network' || error.kind === 'server' || error.kind === 'rate_limited'
    ? new UploadError(error.message, 'retryable')
    : new UploadError(error.message, 'fatal');
}

function sessionOf(res: StartUploadResponse): UploadSession {
  const common = {
    completionRef: res.uploadId,
    uploadId: res.uploadId,
    mediaId: res.mediaId,
    resumed: res.resumed,
    ...(res.previousExpired === true ? { previousExpired: true } : {}),
  };
  if (res.mode === 'single') {
    return { ...common, mode: 'single', uploadUrl: res.post.url, fields: res.post.fields };
  }
  return {
    ...common,
    mode: 'multipart',
    uploadUrl: '',
    partSizeBytes: res.partSizeBytes,
    partCount: res.partCount,
    completedParts: res.completedParts,
  };
}

export interface MediaTransportDeps {
  wait?: (ms: number) => Promise<void>;
  isOnline?: () => boolean;
}

export function createMediaTransport(deps: MediaTransportDeps = {}): UploadTransport {
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    async start(file, signal) {
      try {
        const body = {
          fileName: file.name,
          sizeBytes: file.size,
          contentType: resolveContentType(file),
          fingerprint: await fingerprintOf(file),
        };
        return sessionOf(await mediaApi.startUpload(body, signal));
      } catch (error) {
        throw toUploadError(error);
      }
    },

    async putPart(session, file, onProgress, signal) {
      if (session.mode === 'multipart') {
        await uploadMissingParts(session, file, onProgress, signal, {
          getPartUrls: async (s, partNumbers, sig) => {
            try {
              const res = await mediaApi.partUrls(s.uploadId ?? '', partNumbers, sig);
              return res.parts;
            } catch (error) {
              throw toUploadError(error);
            }
          },
          ...(deps.wait !== undefined ? { wait: deps.wait } : {}),
          ...(deps.isOnline !== undefined ? { isOnline: deps.isOnline } : {}),
        });
        return;
      }
      await postFormToStorage(session, file, onProgress, signal);
    },

    async complete(session, _file, signal, hooks) {
      const uploadId = session.uploadId ?? '';
      try {
        await mediaApi.completeUpload(uploadId, signal);
      } catch (error) {
        throw toUploadError(error);
      }
      hooks?.onProcessing?.();
      // Hỏi tiến trình: 2 giây giãn dần tới 10 giây, tới khi xử lý xong / trùng / bị loại.
      let delay = POLL_FIRST_MS;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      for (;;) {
        await wait(delay);
        if (signal.aborted) throw new DOMException('Đã hủy', 'AbortError');
        let status;
        try {
          status = await mediaApi.uploadStatus(uploadId, signal);
        } catch (error) {
          // Hỏi trạng thái hỏng tạm thời không làm mất tệp (đã vào hàng xử lý): chờ rồi hỏi lại.
          if (isAppError(error) && error.kind === 'not_found') throw toUploadError(error);
          if (Date.now() > deadline) throw toUploadError(error);
          delay = Math.min(POLL_MAX_MS, Math.round(delay * 1.5));
          continue;
        }
        if (status.state === 'duplicate' && status.duplicateOf !== null) {
          return { kind: 'duplicate', duplicateOf: status.duplicateOf } satisfies UploadOutcome;
        }
        if (status.mediaStatus === 'ready' || status.mediaStatus === 'unprocessable') {
          return { kind: status.mediaStatus, mediaId: status.mediaId ?? session.mediaId ?? '' };
        }
        if (Date.now() > deadline) {
          // Quá lâu: coi như đang xử lý; tệp vẫn sẽ xuất hiện trong thư viện khi xong.
          return { kind: 'ready', mediaId: status.mediaId ?? session.mediaId ?? '' };
        }
        delay = Math.min(POLL_MAX_MS, Math.round(delay * 1.5));
      }
    },

    async cancel(session) {
      if (session.uploadId === undefined) return;
      try {
        await mediaApi.cancelUpload(session.uploadId);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
      }
    },
  };
}
