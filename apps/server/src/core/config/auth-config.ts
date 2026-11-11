import type { AppConfig } from './config.schema';
import { ConfigError, type ConfigIssue } from './load-config';

// Cấu hình xác thực của API (004, contracts/auth-ops.md mục 1). Worker không cần nên các biến khai
// báo tùy chọn trong AppConfigSchema; hàm này kiểm đủ khi dựng ApiAppModule – thiếu thì API không
// khởi động, thông báo chỉ nêu tên biến (như assertWorkerDatabaseConfig).

export interface AuthConfig {
  appEnv: AppConfig['APP_ENV'];
  webBaseUrl: string;
  /** Các nguồn (scheme://host[:port]) được gửi yêu cầu thay đổi dữ liệu. */
  webOrigins: string[];
  trustProxyHops: number;
  throttleSecret: string;
  sessionIdleDays: number;
  sessionAbsoluteDays: number;
  staffSessionIdleMinutes: number;
  staffSessionAbsoluteHours: number;
  staffAllowedCidrs: string[];
  loginMaxFailuresPerEmail: number;
  loginMaxFailuresPerIp: number;
  loginWindowMinutes: number;
  loginBlockMinutes: number;
  argon2MemoryKib: number;
  argon2TimeCost: number;
  termsVersion: string;
  mail: { transport: 'memory' } | { transport: 'smtp'; smtpUrl: string; from: string };
}

/** Token NestJS cho cấu hình xác thực đã kiểm tra (chỉ có ở API). */
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

/** Kiểm biến xác thực bắt buộc ở API; trả cấu hình đã chuẩn hóa hoặc ném `ConfigError`. */
export function resolveAuthConfig(config: AppConfig): AuthConfig {
  const issues: ConfigIssue[] = [];
  const required = <T>(variable: string, value: T | undefined): T | undefined => {
    if (value === undefined) issues.push({ variable, reason: 'bắt buộc' });
    return value;
  };

  const webBaseUrl = required('WEB_BASE_URL', config.WEB_BASE_URL);
  const throttleSecret = required('AUTH_THROTTLE_SECRET', config.AUTH_THROTTLE_SECRET);
  const termsVersion = required('TERMS_VERSION', config.TERMS_VERSION);
  const transport = required('MAIL_TRANSPORT', config.MAIL_TRANSPORT);

  if (transport === 'memory' && config.APP_ENV === 'production') {
    issues.push({ variable: 'MAIL_TRANSPORT', reason: '"memory" không dùng được ở production' });
  }
  if (transport === 'smtp') {
    required('SMTP_URL', config.SMTP_URL);
    required('MAIL_FROM', config.MAIL_FROM);
  }
  if (
    issues.length > 0 ||
    webBaseUrl === undefined ||
    throttleSecret === undefined ||
    termsVersion === undefined ||
    transport === undefined
  ) {
    throw new ConfigError(issues);
  }

  const mail: AuthConfig['mail'] =
    transport === 'memory'
      ? { transport: 'memory' }
      : { transport: 'smtp', smtpUrl: config.SMTP_URL ?? '', from: config.MAIL_FROM ?? '' };

  const production = config.APP_ENV === 'staging' || config.APP_ENV === 'production';
  return {
    appEnv: config.APP_ENV,
    webBaseUrl: webBaseUrl.replace(/\/+$/, ''),
    webOrigins: (config.WEB_ORIGINS ?? [webBaseUrl]).map((url) => new URL(url).origin),
    trustProxyHops: config.TRUST_PROXY_HOPS ?? (production ? 1 : 0),
    throttleSecret,
    sessionIdleDays: config.SESSION_IDLE_DAYS,
    sessionAbsoluteDays: config.SESSION_ABSOLUTE_DAYS,
    staffSessionIdleMinutes: config.STAFF_SESSION_IDLE_MINUTES,
    staffSessionAbsoluteHours: config.STAFF_SESSION_ABSOLUTE_HOURS,
    staffAllowedCidrs: config.STAFF_ALLOWED_CIDRS,
    loginMaxFailuresPerEmail: config.LOGIN_MAX_FAILURES_PER_EMAIL,
    loginMaxFailuresPerIp: config.LOGIN_MAX_FAILURES_PER_IP,
    loginWindowMinutes: config.LOGIN_WINDOW_MINUTES,
    loginBlockMinutes: config.LOGIN_BLOCK_MINUTES,
    argon2MemoryKib: config.ARGON2_MEMORY_KIB,
    argon2TimeCost: config.ARGON2_TIME_COST,
    termsVersion,
    mail,
  };
}
