import { Module } from '@nestjs/common';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth-config';
import { MAILER, type Mailer } from './mailer';
import { MemoryMailTransport } from './memory.transport';
import { SmtpMailTransport } from './smtp.transport';

/** Chọn bộ gửi thư theo MAIL_TRANSPORT. Cần AUTH_CONFIG (AuthModule – chỉ có ở API). */
export function createMailer(config: AuthConfig): Mailer {
  return config.mail.transport === 'memory'
    ? new MemoryMailTransport()
    : new SmtpMailTransport(config.mail.smtpUrl, config.mail.from);
}

@Module({
  providers: [{ provide: MAILER, inject: [AUTH_CONFIG], useFactory: createMailer }],
  exports: [MAILER],
})
export class MailModule {}
