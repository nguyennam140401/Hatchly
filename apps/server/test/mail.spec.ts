import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthConfig } from '../src/core/config/auth-config';
import { createMailer } from '../src/core/mail/mail.module';
import { MemoryMailTransport } from '../src/core/mail/memory.transport';
import { SmtpMailTransport } from '../src/core/mail/smtp.transport';

// T029 (004, R9): chọn bộ gửi thư theo MAIL_TRANSPORT; bộ nhớ cho kiểm thử; SMTP lỗi chỉ lộ mã.

const msg = { to: 'a@example.test', subject: 'Chủ đề', text: 'chữ', html: '<p>chữ</p>' };

describe('Mailer', () => {
  it('createMailer chọn theo cấu hình', () => {
    expect(createMailer({ mail: { transport: 'memory' } } as AuthConfig)).toBeInstanceOf(
      MemoryMailTransport,
    );
    expect(
      createMailer({
        mail: { transport: 'smtp', smtpUrl: 'smtp://localhost:1025', from: 'a@b.test' },
      } as AuthConfig),
    ).toBeInstanceOf(SmtpMailTransport);
  });

  it('MemoryMailTransport giữ thư, clear, failNext', async () => {
    const m = new MemoryMailTransport();
    await m.send(msg);
    expect(m.messages()).toEqual([msg]);
    m.clear();
    expect(m.messages()).toHaveLength(0);
    m.failNext = true;
    await expect(m.send(msg)).rejects.toThrow('MAIL_SEND_FAILED');
    await m.send(msg);
    expect(m.messages()).toHaveLength(1);
  });

  describe('SmtpMailTransport', () => {
    let server: Server;
    let port: number;
    beforeAll(async () => {
      // Máy chủ đóng kết nối ngay → lỗi gửi thư.
      server = createServer((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as { port: number }).port;
    });
    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('lỗi chỉ mang mã, không lộ người dùng/mật khẩu SMTP', async () => {
      const t = new SmtpMailTransport(
        `smtp://smtp-user:smtp-secret-pass@127.0.0.1:${port}`,
        'no-reply@example.test',
      );
      const err = await t.send(msg).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err?.message).toMatch(/^MAIL_SEND_FAILED:/);
      expect(err?.message).not.toContain('smtp-secret-pass');
      expect(err?.message).not.toContain('smtp-user');
    });
  });
});
