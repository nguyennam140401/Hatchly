import type { JobContext } from '../../queue';
import type { ContextPublicApi } from '../public-api';

// Bộ xử lý MẪU của việc "hồ sơ đã thay đổi" (006 data-model mục 5) – chạy ở Worker.
// Chạy lại an toàn (hiến pháp V): KHÔNG ghi CSDL, chỉ đọc hồ sơ hiện hành rồi ghi nhật ký; việc của
// phiên bản cũ (đã có phiên bản mới hơn) được bỏ qua.
// T7 gắn AI tóm tắt hồ sơ (qua Cổng AI – nguyên tắc III) tại đây, kèm kiểm "đã tóm tắt phiên bản này
// chưa" trước khi gọi để vẫn chạy lại an toàn.

export interface ProfileChangedLog {
  info(entry: Record<string, unknown> & { msg: string; event: string }): void;
}

export type ProfileChangedOutcome = 'processed' | 'superseded';

export function createProfileChangedHandler(deps: {
  context: ContextPublicApi;
  log: ProfileChangedLog;
}): (payload: { profileId: string; version: number }, ctx: JobContext) => Promise<void> {
  return async (payload, ctx) => {
    const current = await deps.context.getCurrentProfile();
    const currentVersion = current?.version ?? null;
    const outcome: ProfileChangedOutcome =
      current?.profileId !== payload.profileId || current.version > payload.version
        ? 'superseded'
        : 'processed';
    // Chỉ mã tham chiếu và số phiên bản – KHÔNG nội dung hồ sơ (FR-020).
    deps.log.info({
      msg: `context.profile_changed.${outcome}`,
      event: `context.profile_changed.${outcome}`,
      job_id: ctx.jobId,
      version: payload.version,
      current_version: currentVersion,
      trace_id: ctx.traceId,
    });
  };
}
