import { Inject, Injectable, Logger } from '@nestjs/common';
import { AUTH_CONFIG, MAILER, type AuthConfig, type Mailer } from '../../../../../core';
import { recordMailFailed, recordMailSend } from '../auth-metrics';
import { renderTemplate, type TemplateName, type TemplateVars } from './templates';

// Gửi thư SAU khi giao dịch đã xác nhận, không chờ trong luồng phản hồi (R9): thời gian phản hồi không
// phụ thuộc có gửi thư hay không (FR-008b, SC-006). Giới hạn 10 giây. Lỗi → `mail.send_failed` với
// `user_id`, `template` – KHÔNG ghi địa chỉ thư. Người dùng có nút "Gửi lại".
// Khi có hàng chờ `notify` (003): thay bằng tạo việc trong cùng giao dịch (Phạm vi giao cho sau).

const SEND_TIMEOUT_MS = 10_000;

@Injectable()
export class MailDispatcher {
  private readonly logger = new Logger('Mail');
  /** Các lần gửi đang chạy – kiểm thử chờ cho xong bằng `drain()`. */
  private readonly pending = new Set<Promise<void>>();

  constructor(
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /** Gọi SAU khi giao dịch đã commit. Không ném. */
  sendAfterCommit(
    template: TemplateName,
    to: string,
    vars: Omit<TemplateVars, 'webBaseUrl'> & { userId?: string | null | undefined },
  ): void {
    const committedAt = process.hrtime.bigint(); // mốc đo SC-004: giao dịch vừa xác nhận
    const job = new Promise<void>((resolve) => {
      setImmediate(() => {
        void this.send(template, to, vars, committedAt).finally(resolve);
      });
    });
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
  }

  private async send(
    template: TemplateName,
    to: string,
    vars: Omit<TemplateVars, 'webBaseUrl'> & { userId?: string | null | undefined },
    committedAt: bigint,
  ): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      // `userId` chỉ dùng cho nhật ký lỗi bên dưới – mẫu thư bỏ qua khóa lạ.
      const content = renderTemplate(template, { ...vars, webBaseUrl: this.config.webBaseUrl });
      await Promise.race([
        this.mailer.send({ to, ...content }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('MAIL_TIMEOUT'));
          }, SEND_TIMEOUT_MS);
        }),
      ]);
      recordMailSend(template, Number(process.hrtime.bigint() - committedAt) / 1e9);
    } catch (err) {
      recordMailFailed(template);
      this.logger.warn({
        msg: 'mail.send_failed',
        event: 'mail.send_failed',
        user_id: vars.userId ?? null,
        template,
        code: err instanceof Error ? err.message.split(':')[0] : 'UNKNOWN',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Chờ mọi thư đang gửi (kiểm thử, tắt ứng dụng). */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }
}
