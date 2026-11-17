import { registerAdapter } from '../registry';
import { FacebookAdapter } from './facebook.adapter';
import { GraphClient } from './graph-client';
import { InstagramAdapter } from './instagram.adapter';

export interface MetaAdapterConfig {
  baseUrl: string;
  /** Phiên bản Graph API CỐ ĐỊNH (vd `v21.0`) – đổi phiên bản là một thay đổi có chủ đích. */
  version: string;
  timeoutMs: number;
  facebookReconcile: boolean;
  instagramReconcile: boolean;
  facebookVideoMaxBytes: number;
}

/**
 * Đăng ký bộ chuyển đổi THẬT của Facebook Page và Instagram (013 R10). Chỉ gọi khi `PLATFORM_ADAPTER_MODE=real`;
 * thay thế bản giả lập cùng loại kênh (Zalo OA, kênh thử vẫn dùng bản giả – không chặn luồng đăng).
 */
export function registerMetaAdapters(cfg: MetaAdapterConfig): void {
  const common = { baseUrl: cfg.baseUrl, version: cfg.version, timeoutMs: cfg.timeoutMs };
  registerAdapter(
    'facebook_page',
    () =>
      new FacebookAdapter({
        client: new GraphClient(common, 'FB'),
        reconcile: cfg.facebookReconcile,
        videoMaxBytes: cfg.facebookVideoMaxBytes,
      }),
  );
  registerAdapter(
    'instagram',
    () =>
      new InstagramAdapter({
        client: new GraphClient(common, 'IG'),
        reconcile: cfg.instagramReconcile,
      }),
  );
}
