import { createTransport, type Transporter } from 'nodemailer';
import type { MailMessage, Mailer } from './mailer';

// Gửi thư qua SMTP (môi trường thật: Amazon SES; dev: Mailpit). Thư viện bọc sau giao diện `Mailer`
// (nguyên tắc IX). Lỗi chỉ giữ mã, không giữ thông điệp gốc (có thể chứa máy chủ/người dùng SMTP).

const SEND_TIMEOUT_MS = 10_000;

export class SmtpMailTransport implements Mailer {
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    const url = new URL(smtpUrl);
    const secure = url.protocol === 'smtps:';
    this.transporter = createTransport({
      host: url.hostname,
      port: url.port === '' ? (secure ? 465 : 587) : Number(url.port),
      secure,
      ...(url.username !== ''
        ? {
            auth: {
              user: decodeURIComponent(url.username),
              pass: decodeURIComponent(url.password),
            },
          }
        : {}),
      connectionTimeout: SEND_TIMEOUT_MS,
      greetingTimeout: SEND_TIMEOUT_MS,
      socketTimeout: SEND_TIMEOUT_MS,
    });
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, ...message });
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      const error = new Error(`MAIL_SEND_FAILED:${typeof code === 'string' ? code : 'UNKNOWN'}`);
      throw error;
    }
  }
}
