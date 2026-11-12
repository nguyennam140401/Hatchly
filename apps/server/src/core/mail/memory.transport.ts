import { randomUUID } from 'node:crypto';
import { sendViaDeliver, type MailDeliveryResult, type MailMessage, type Mailer } from './mailer';

/** Bộ gửi thư giữ thư trong bộ nhớ – CHỈ cho kiểm thử (bị từ chối ở staging/production). */
export class MemoryMailTransport implements Mailer {
  private readonly sent: MailMessage[] = [];
  private readonly failures = new Map<string, { kind: 'transient' | 'permanent'; times: number }>();
  /** Kiểm thử đặt để giả lập lỗi gửi (004). */
  failNext = false;

  /** Kịch bản lỗi theo địa chỉ: `times` lần tiếp theo (mặc định mãi mãi). */
  failFor(
    address: string,
    kind: 'transient' | 'permanent',
    times = Number.POSITIVE_INFINITY,
  ): void {
    this.failures.set(address.toLowerCase(), { kind, times });
  }

  deliver(message: MailMessage): Promise<MailDeliveryResult> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.resolve({ kind: 'transient', code: 'MEMORY_FAIL_NEXT' });
    }
    const rule = this.failures.get(message.to.toLowerCase());
    if (rule !== undefined && rule.times > 0) {
      rule.times -= 1;
      if (rule.times <= 0) this.failures.delete(message.to.toLowerCase());
      return Promise.resolve(
        rule.kind === 'permanent'
          ? { kind: 'permanent', code: '550' }
          : { kind: 'transient', code: '421' },
      );
    }
    this.sent.push({ ...message });
    return Promise.resolve({ kind: 'sent', messageId: randomUUID() });
  }

  send(message: MailMessage): Promise<void> {
    return sendViaDeliver(this, message);
  }

  messages(): readonly MailMessage[] {
    return this.sent;
  }

  /** Hộp thư đi (005). */
  outbox(): readonly MailMessage[] {
    return this.sent;
  }

  clear(): void {
    this.sent.length = 0;
    this.failures.clear();
  }
}
