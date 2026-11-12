import { describe } from 'vitest';
import { MemoryMailTransport } from '../../../src/core/mail/memory.transport';
import { describeMailerContract } from './mailer.contract';

// 005 T068: bộ gửi thư `memory` (pnpm test) – lỗi theo địa chỉ bằng failFor.
const mail = new MemoryMailTransport();
mail.failFor('tam-loi@example.test', 'transient');
mail.failFor('vinh-vien@example.test', 'permanent');

describe('Bộ gửi thư – memory', () => {
  describeMailerContract(
    () => mail,
    () => ({
      find: (subject) => Promise.resolve(mail.outbox().find((m) => m.subject === subject)),
      failTo: (kind) => (kind === 'transient' ? 'tam-loi@example.test' : 'vinh-vien@example.test'),
    }),
  );
});
