import { createTransport, type Transporter } from 'nodemailer';
import { sendViaDeliver, type MailDeliveryResult, type MailMessage, type Mailer } from './mailer';

// Gửi thư qua SMTP (môi trường thật: Amazon SES; dev: Mailpit). Thư viện bọc sau giao diện `Mailer`
// (nguyên tắc IX). Lỗi chỉ giữ mã, không giữ thông điệp gốc (có thể chứa máy chủ/người dùng SMTP).

const SEND_TIMEOUT_MS = 10_000;
const PERMANENT_CODES = new Set([550, 551, 552, 553, 554]);

/** Phân loại lỗi SMTP (005, R14): 550–554 → permanent; 4xx, lỗi mạng, còn lại → transient. */
export function classifySmtpError(err: unknown): MailDeliveryResult {
  const e = (err ?? {}) as { responseCode?: unknown; code?: unknown };
  const responseCode = typeof e.responseCode === 'number' ? e.responseCode : undefined;
  if (responseCode !== undefined && PERMANENT_CODES.has(responseCode)) {
    return { kind: 'permanent', code: String(responseCode) };
  }
  if (responseCode !== undefined) return { kind: 'transient', code: String(responseCode) };
  const code = typeof e.code === 'string' ? e.code.replace(/[^A-Z0-9_]/g, '').slice(0, 32) : '';
  return { kind: 'transient', code: code === '' ? 'UNKNOWN' : code };
}

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

  async deliver(message: MailMessage): Promise<MailDeliveryResult> {
    try {
      const info = (await this.transporter.sendMail({ from: this.from, ...message })) as {
        messageId?: unknown;
      };
      return { kind: 'sent', messageId: typeof info.messageId === 'string' ? info.messageId : '' };
    } catch (err) {
      return classifySmtpError(err);
    }
  }

  send(message: MailMessage): Promise<void> {
    return sendViaDeliver(this, message);
  }
}
