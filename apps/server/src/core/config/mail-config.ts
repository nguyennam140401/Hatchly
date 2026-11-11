import type { AppConfig } from './config.schema';
import { ConfigError, type ConfigIssue } from './config-error';

// Cấu hình gửi thư dùng chung API + Worker (005, R14 – chuyển khỏi AuthConfig của 004 để hàng chờ
// `notify` ở Worker gửi được thư). `AuthConfig.mail` vẫn giữ nguyên hình dạng, dựng từ hàm này.

export type MailConfig =
  { transport: 'memory' } | { transport: 'smtp'; smtpUrl: string; from: string };

/**
 * `MAIL_TRANSPORT` thiếu: development/test → `memory` khi `defaultToMemory` (Worker); ngược lại
 * bắt buộc. `smtp` → `SMTP_URL`, `MAIL_FROM` bắt buộc. Thông báo lỗi chỉ nêu tên biến.
 */
export function resolveMailConfig(
  config: AppConfig,
  opts: { defaultToMemory?: boolean } = {},
): MailConfig {
  const issues: ConfigIssue[] = [];
  const devLike = config.APP_ENV === 'development' || config.APP_ENV === 'test';
  const transport =
    config.MAIL_TRANSPORT ?? (devLike && opts.defaultToMemory === true ? 'memory' : undefined);
  if (transport === undefined) {
    throw new ConfigError([{ variable: 'MAIL_TRANSPORT', reason: 'bắt buộc' }]);
  }
  if (transport === 'memory') return { transport: 'memory' };
  if (config.SMTP_URL === undefined) issues.push({ variable: 'SMTP_URL', reason: 'bắt buộc' });
  if (config.MAIL_FROM === undefined) issues.push({ variable: 'MAIL_FROM', reason: 'bắt buộc' });
  if (issues.length > 0 || config.SMTP_URL === undefined || config.MAIL_FROM === undefined) {
    throw new ConfigError(issues);
  }
  return { transport: 'smtp', smtpUrl: config.SMTP_URL, from: config.MAIL_FROM };
}
