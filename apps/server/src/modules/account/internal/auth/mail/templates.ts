import type { MailMessage } from '../../../../../core';

// Mẫu thư tiếng Việt đời thường (R9): bản chữ + HTML đơn giản. KHÔNG BAO GIỜ chứa mật khẩu hay số tiền
// AI. Mã một lần nằm ở `#fragment` của liên kết → không lọt vào nhật ký máy chủ/Referer (R8).

export type TemplateName =
  'verifyEmail' | 'emailAlreadyRegistered' | 'resetPassword' | 'passwordChanged';

export interface TemplateVars {
  webBaseUrl: string;
  displayName?: string | undefined;
  /** Mã một lần (verifyEmail, resetPassword). */
  token?: string | undefined;
}

type Content = Omit<MailMessage, 'to'>;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function greeting(name: string | undefined): string {
  return name === undefined || name.trim() === '' ? 'Xin chào,' : `Xin chào ${name},`;
}

function button(href: string, label: string): string {
  return `<p><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

function layout(paragraphs: string[]): string {
  return `<!doctype html><html lang="vi"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a;max-width:560px;margin:0 auto;padding:16px">${paragraphs.join('')}</body></html>`;
}

function requireToken(vars: TemplateVars): string {
  if (vars.token === undefined) throw new Error('Mẫu thư cần mã một lần');
  return vars.token;
}

export function renderTemplate(name: TemplateName, vars: TemplateVars): Content {
  const base = vars.webBaseUrl;
  const hello = greeting(vars.displayName);
  const helloHtml = `<p>${escapeHtml(hello)}</p>`;
  switch (name) {
    case 'verifyEmail': {
      const link = `${base}/verify-email#token=${requireToken(vars)}`;
      return {
        subject: 'Xác nhận email của bạn',
        text: [
          hello,
          '',
          'Bấm vào liên kết dưới đây để xác nhận email và bắt đầu dùng ứng dụng:',
          link,
          '',
          'Liên kết dùng được một lần trong 24 giờ. Nếu bạn không đăng ký, hãy bỏ qua thư này.',
        ].join('\n'),
        html: layout([
          helloHtml,
          '<p>Bấm nút dưới đây để xác nhận email và bắt đầu dùng ứng dụng.</p>',
          button(link, 'Xác nhận email'),
          '<p>Liên kết dùng được một lần trong 24 giờ. Nếu bạn không đăng ký, hãy bỏ qua thư này.</p>',
        ]),
      };
    }
    case 'emailAlreadyRegistered': {
      const login = `${base}/login`;
      const forgot = `${base}/forgot-password`;
      return {
        subject: 'Email này đã có tài khoản',
        text: [
          hello,
          '',
          'Có người vừa dùng email này để đăng ký, nhưng email đã có tài khoản.',
          `Đăng nhập: ${login}`,
          `Quên mật khẩu: ${forgot}`,
          '',
          'Nếu không phải bạn, hãy bỏ qua thư này – tài khoản của bạn không thay đổi.',
        ].join('\n'),
        html: layout([
          helloHtml,
          '<p>Có người vừa dùng email này để đăng ký, nhưng email đã có tài khoản.</p>',
          button(login, 'Đăng nhập'),
          button(forgot, 'Quên mật khẩu'),
          '<p>Nếu không phải bạn, hãy bỏ qua thư này – tài khoản của bạn không thay đổi.</p>',
        ]),
      };
    }
    case 'resetPassword': {
      const link = `${base}/reset-password#token=${requireToken(vars)}`;
      return {
        subject: 'Đặt lại mật khẩu',
        text: [
          hello,
          '',
          'Bấm vào liên kết dưới đây để đặt mật khẩu mới:',
          link,
          '',
          'Liên kết dùng được một lần trong 30 phút. Nếu bạn không yêu cầu, hãy bỏ qua thư này.',
        ].join('\n'),
        html: layout([
          helloHtml,
          '<p>Bấm nút dưới đây để đặt mật khẩu mới.</p>',
          button(link, 'Đặt mật khẩu mới'),
          '<p>Liên kết dùng được một lần trong 30 phút. Nếu bạn không yêu cầu, hãy bỏ qua thư này.</p>',
        ]),
      };
    }
    case 'passwordChanged': {
      const forgot = `${base}/forgot-password`;
      return {
        subject: 'Mật khẩu của bạn vừa được thay đổi',
        text: [
          hello,
          '',
          'Mật khẩu tài khoản của bạn vừa được thay đổi và các thiết bị khác đã được đăng xuất.',
          `Nếu không phải bạn làm, hãy đặt lại mật khẩu ngay: ${forgot}`,
          'và liên hệ đội hỗ trợ.',
        ].join('\n'),
        html: layout([
          helloHtml,
          '<p>Mật khẩu tài khoản của bạn vừa được thay đổi và các thiết bị khác đã được đăng xuất.</p>',
          '<p>Nếu không phải bạn làm, hãy đặt lại mật khẩu ngay và liên hệ đội hỗ trợ.</p>',
          button(forgot, 'Đặt lại mật khẩu'),
        ]),
      };
    }
  }
}
