import { registerAdapter } from '../registry';
import { FacebookAdapter } from './facebook.adapter';
import { GraphClient } from './graph-client';
import { InstagramAdapter } from './instagram.adapter';
import { MetaOAuth, resolveMetaScopes, type ScopeGroup } from './meta-oauth';

export interface MetaAdapterConfig {
  baseUrl: string;
  /** Phiên bản Graph API CỐ ĐỊNH (vd `v21.0`) – đổi phiên bản là một thay đổi có chủ đích. */
  version: string;
  timeoutMs: number;
  facebookReconcile: boolean;
  instagramReconcile: boolean;
  facebookVideoMaxBytes: number;
  /** 010: ứng dụng Meta dùng cho kết nối kênh; `null` ⇒ chưa cấu hình (kết nối trả "đang chuẩn bị"). */
  oauth?: {
    appId: string;
    appSecret: string;
    dialogBaseUrl: string;
    scopeGroups: readonly ScopeGroup[];
    /** Ghi đè danh sách quyền theo nền tảng (CHANNEL_SCOPES_*). */
    scopeOverrides?: { facebook_page?: string | undefined; instagram?: string | undefined };
    tokenRefresh: boolean;
  } | null;
}

/**
 * Đăng ký bộ chuyển đổi THẬT của Facebook Page và Instagram (013 R10). Chỉ gọi khi `PLATFORM_ADAPTER_MODE=real`;
 * thay thế bản giả lập cùng loại kênh (Zalo OA, kênh thử vẫn dùng bản giả – không chặn luồng đăng).
 */
export function registerMetaAdapters(cfg: MetaAdapterConfig): void {
  const common = { baseUrl: cfg.baseUrl, version: cfg.version, timeoutMs: cfg.timeoutMs };
  const o = cfg.oauth ?? null;
  const oauth =
    o === null
      ? null
      : new MetaOAuth({
          client: new GraphClient(common, 'FB'),
          appId: o.appId,
          appSecret: o.appSecret,
          dialogBaseUrl: o.dialogBaseUrl,
          version: cfg.version,
          scopes: {
            facebook_page: resolveMetaScopes(
              'facebook_page',
              o.scopeGroups,
              o.scopeOverrides?.facebook_page,
            ),
            instagram: resolveMetaScopes('instagram', o.scopeGroups, o.scopeOverrides?.instagram),
          },
        });
  registerAdapter(
    'facebook_page',
    () =>
      new FacebookAdapter({
        client: new GraphClient(common, 'FB'),
        reconcile: cfg.facebookReconcile,
        videoMaxBytes: cfg.facebookVideoMaxBytes,
        oauth,
        tokenRefresh: o?.tokenRefresh ?? false,
      }),
  );
  registerAdapter(
    'instagram',
    () =>
      new InstagramAdapter({
        client: new GraphClient(common, 'IG'),
        reconcile: cfg.instagramReconcile,
        oauth,
      }),
  );
}
