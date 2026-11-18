// Bước 2 – Chuẩn bị media (FR-014, FR-014a). Lấy đường dẫn ký sẵn (đúng tiền tố `tenants/{mã}/`, hạn ≤ 24 giờ) từ
// Thư viện media và kiểm theo `mediaRules()` của kênh (KHÔNG hằng số cứng 500 MB/1 GB – đọc từ bộ chuyển đổi).
// Không có media → `not_applicable`. Không dùng được → lỗi cần người dùng: "vui lòng chọn ảnh khác".
import { validateMedia, type MediaDescriptor } from '../../../platform_gateway';
import { finishStep, startStep } from '../step-log';
import { applyFailure, userFailure } from './outcomes';
import { cont, stop, type ExecutorDeps, type Flow, type RunContext } from './types';
import type { PrecheckValue } from './precheck';

export interface PreparedMedia {
  items: { url: string; kind: 'image' | 'video'; mediaId: string }[];
}

const EDIT_MEDIA = [{ action: 'edit_media', labelVi: 'Chọn ảnh hoặc video khác' }];
const TTL_SEC = 86_400;

export async function prepareMedia(
  deps: ExecutorDeps,
  run: RunContext,
  pre: PrecheckValue,
): Promise<Flow<PreparedMedia>> {
  await startStep(run.step, 'prepare_media');
  const ids = pre.variant.media.map((m) => m.mediaId);
  if (ids.length === 0) {
    await finishStep(run.step, 'prepare_media', 'not_applicable', {
      note: 'Bài không có ảnh/video',
    });
    return cont({ items: [] });
  }

  const fail = async (messageVi: string, rawCode: string) =>
    stop(
      await applyFailure(
        deps,
        run,
        'prepare_media',
        userFailure('media_invalid', messageVi, EDIT_MEDIA, rawCode),
        false,
      ),
    );

  const result = await deps.media.getPublishableMedia(ids, { ttlSec: TTL_SEC });
  if (result.kind === 'unavailable') {
    return fail(
      'Không lấy được ảnh hoặc video của bài này (có thể đã bị xóa hoặc chưa xử lý xong). Vui lòng chọn ảnh khác.',
      'MEDIA_UNAVAILABLE',
    );
  }

  const { rules } = await deps.gateway.mediaRules(run.attempt.channel_connection_id);
  const descriptors: MediaDescriptor[] = result.items.map((i) => ({
    mediaId: i.mediaId,
    kind: i.kind,
    format: i.format,
    bytes: i.bytes,
    width: i.width,
    height: i.height,
    ...(i.durationSec !== undefined ? { durationSec: i.durationSec } : {}),
  }));
  const violations = validateMedia(rules, descriptors);
  if (violations.length > 0) {
    const first = violations[0];
    return fail(
      `${first?.messageVi ?? 'Ảnh hoặc video chưa phù hợp với kênh.'} Vui lòng chọn ảnh khác.`,
      'MEDIA_RULE',
    );
  }

  await finishStep(run.step, 'prepare_media', 'succeeded');
  return cont({
    items: result.items.map((i) => ({ url: i.url, kind: i.kind, mediaId: i.mediaId })),
  });
}
