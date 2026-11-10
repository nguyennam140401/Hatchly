import type { MailMessage, Mailer } from './mailer';

/** Bộ gửi thư giữ thư trong bộ nhớ – CHỈ cho kiểm thử (bị từ chối khi APP_ENV=production). */
export class MemoryMailTransport implements Mailer {
  private readonly sent: MailMessage[] = [];
  /** Kiểm thử đặt để giả lập lỗi gửi. */
  failNext = false;

  send(message: MailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('MAIL_SEND_FAILED'));
    }
    this.sent.push({ ...message });
    return Promise.resolve();
  }

  messages(): readonly MailMessage[] {
    return this.sent;
  }

  clear(): void {
    this.sent.length = 0;
  }
}
