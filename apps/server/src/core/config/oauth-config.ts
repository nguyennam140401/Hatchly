import type { AppConfig } from './config.schema';
import { ConfigError, type ConfigIssue } from './config-error';

// Cấu hình đăng nhập Google/Facebook, lời mời và tài khoản chờ (009, contracts/module-api.md mục 6).
// Dùng ở cả API (vòng đăng nhập, lời mời) và Worker (việc định kỳ xóa người ở tài khoản chờ), nên
// tách khỏi AuthConfig (chỉ API). Thông báo lỗi chỉ nêu tên biến – không bao giờ có giá trị.

export type OAuthDriver = 'real' | 'fake' | 'off';

export interface OAuthConfig {
  /**
   * `off`: staging/production chưa đặt `OAUTH_DRIVER` – điểm cuối bắt đầu đăng nhập qua nhà cung cấp
   * trả 503 `PROVIDER_UNAVAILABLE`; đăng nhập bằng email vẫn chạy (nguyên tắc VI: không chặn khi
   * không cần).
   */
  driver: OAuthDriver;
  google: { clientId: string; clientSecret: string } | null;
  facebook: { appId: string; appSecret: string } | null;
  facebookGraphVersion: string;
  /** Hạn của vòng đi – về với nhà cung cấp. */
  flowTtlMinutes: number;
  /** Hạn bước chờ trên trình duyệt và liên kết xác nhận liên kết. */
  linkConfirmTtlMinutes: number;
  reauthWindowMinutes: number;
  inviteTtlDays: number;
  inviteMaxPerAccountPerDay: number;
  detachedRetentionDays: number;
  detachedNoticeDays: number;
}

/** Token NestJS cho cấu hình đã kiểm tra (API và Worker). */
export const OAUTH_CONFIG = Symbol('OAUTH_CONFIG');

/**
 * `requireCredentials` (API): `OAUTH_DRIVER=real` mà thiếu khóa Google/Facebook → `ConfigError` nêu đủ
 * tên biến, API không khởi động. Worker không gọi nhà cung cấp nên không đòi khóa.
 */
export function resolveOAuthConfig(
  config: AppConfig,
  opts: { requireCredentials?: boolean } = {},
): OAuthConfig {
  const driver: OAuthDriver = config.OAUTH_DRIVER ?? 'off';
  const issues: ConfigIssue[] = [];
  if (driver === 'real' && opts.requireCredentials === true) {
    for (const variable of [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'FACEBOOK_APP_ID',
      'FACEBOOK_APP_SECRET',
    ] as const) {
      if (config[variable] === undefined) {
        issues.push({ variable, reason: 'bắt buộc khi OAUTH_DRIVER=real' });
      }
    }
  }
  if (issues.length > 0) throw new ConfigError(issues);

  const google =
    config.GOOGLE_CLIENT_ID !== undefined && config.GOOGLE_CLIENT_SECRET !== undefined
      ? { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET }
      : null;
  const facebook =
    config.FACEBOOK_APP_ID !== undefined && config.FACEBOOK_APP_SECRET !== undefined
      ? { appId: config.FACEBOOK_APP_ID, appSecret: config.FACEBOOK_APP_SECRET }
      : null;
  return {
    driver,
    google,
    facebook,
    facebookGraphVersion: config.FACEBOOK_GRAPH_VERSION,
    flowTtlMinutes: config.OAUTH_FLOW_TTL_MINUTES,
    linkConfirmTtlMinutes: config.LINK_CONFIRM_TTL_MINUTES,
    reauthWindowMinutes: config.REAUTH_WINDOW_MINUTES,
    inviteTtlDays: config.INVITE_TTL_DAYS,
    inviteMaxPerAccountPerDay: config.INVITE_MAX_PER_ACCOUNT_PER_DAY,
    detachedRetentionDays: config.DETACHED_RETENTION_DAYS,
    detachedNoticeDays: config.DETACHED_NOTICE_DAYS,
  };
}
