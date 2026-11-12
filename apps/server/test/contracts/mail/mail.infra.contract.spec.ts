import { describe } from 'vitest';
import { SmtpMailTransport } from '../../../src/core/mail/smtp.transport';
import { describeMailerContract } from './mailer.contract';

// 005 T068: bộ gửi thư THẬT `smtp` → Mailpit (pnpm test:infra, cần `docker compose up -d mailpit`).
// Mailpit v1.27 nhận mọi người nhận – không giả lập được lỗi transient/permanent theo địa chỉ; hai ca đó
// bỏ qua có lý do, phân loại mã SMTP kiểm ở test/unit/mail/smtp-classify.spec.ts.

const SMTP_URL = process.env.TEST_SMTP_URL ?? 'smtp://localhost:1025';
const MAILPIT_API = process.env.TEST_MAILPIT_API ?? 'http://localhost:8025';

describe('Bộ gửi thư – smtp → Mailpit', () => {
  const mailer = new SmtpMailTransport(SMTP_URL, '"App" <no-reply@example.test>');
  describeMailerContract(
    () => mailer,
    () => ({
      async find(subject, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const res = await fetch(`${MAILPIT_API}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`);
          const body = (await res.json()) as { messages?: { Subject: string; To: { Address: string }[] }[] };
          const m = body.messages?.find((x) => x.Subject === subject);
          if (m !== undefined) return { subject: m.Subject, to: m.To.map((t) => t.Address).join(',') };
          await new Promise((r) => setTimeout(r, 200));
        }
        return undefined;
      },
    }),
  );
});
