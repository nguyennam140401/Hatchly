import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Mailer } from '../../../src/core/mail/mailer';

// Bộ kiểm thử hợp đồng bộ gửi thư (005, contracts/notifications.md mục 5/7). `inbox` đọc lại thư đã nhận
// (memory: hộp thư đi; smtp → Mailpit: API HTTP). `failTo` – địa chỉ gây lỗi theo loại (nếu hỗ trợ).

export interface MailInbox {
  find(subject: string, timeoutMs: number): Promise<{ to: string; subject: string } | undefined>;
  failTo?: (kind: 'transient' | 'permanent') => string | undefined;
}

export function describeMailerContract(make: () => Mailer, inbox: () => MailInbox): void {
  describe('bộ gửi thư', () => {
    it('sent → đọc lại được trong hộp thư (≤ 10 giây – SC-011)', async () => {
      const subject = `Kiểm thử ${randomUUID()}`;
      const r = await make().deliver({
        to: 'chu@example.test',
        subject,
        text: 'xin chào',
        html: '<p>xin chào</p>',
      });
      expect(r.kind).toBe('sent');
      const started = Date.now();
      const got = await inbox().find(subject, 10_000);
      expect(got?.to).toContain('chu@example.test');
      expect(Date.now() - started).toBeLessThanOrEqual(10_000);
    });

    for (const kind of ['transient', 'permanent'] as const) {
      it(`${kind} phân biệt đúng; send() vẫn ném như 004`, async (ctx) => {
        const to = inbox().failTo?.(kind);
        if (to === undefined) {
          ctx.skip(); // bản cài đặt/dịch vụ không giả lập được loại lỗi này – phân loại kiểm ở test/unit/mail
          return;
        }
        const msg = { to, subject: `Lỗi ${kind}`, text: 'x', html: '<p>x</p>' };
        expect((await make().deliver(msg)).kind).toBe(kind);
        await expect(make().send(msg)).rejects.toThrow(/^MAIL_SEND_FAILED:/);
      });
    }
  });
}
