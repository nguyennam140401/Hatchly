import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.schema';
import { resolveMailConfig, type MailConfig } from '../config/mail-config';
import { MAILER, type Mailer } from './mailer';
import { MemoryMailTransport } from './memory.transport';
import { SmtpMailTransport } from './smtp.transport';

/** Chọn bộ gửi thư theo MAIL_TRANSPORT (nhận `MailConfig` hoặc đối tượng có `mail` như AuthConfig). */
export function createMailer(config: MailConfig | { mail: MailConfig }): Mailer {
  const mail = 'mail' in config ? config.mail : config;
  return mail.transport === 'memory'
    ? new MemoryMailTransport()
    : new SmtpMailTransport(mail.smtpUrl, mail.from);
}

/**
 * Bộ gửi thư ở cả API và Worker (005, R14). Đọc cấu hình chung `APP_CONFIG`; Worker ở development/test
 * thiếu `MAIL_TRANSPORT` → bộ nhớ. API vẫn bắt buộc `MAIL_TRANSPORT` qua `resolveAuthConfig` (004).
 */
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        createMailer(resolveMailConfig(config, { defaultToMemory: true })),
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
