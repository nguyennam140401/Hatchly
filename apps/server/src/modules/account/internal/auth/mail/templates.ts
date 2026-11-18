import type { MailMessage } from '../../../../../core';

// Mẫu thư tiếng Việt đời thường (R9): bản chữ + HTML đơn giản. KHÔNG BAO GIỜ chứa mật khẩu hay số tiền
// AI. Mã một lần nằm ở `#fragment` của liên kết → không lọt vào nhật ký máy chủ/Referer (R8).

export type TemplateName =
  | 'verifyEmail'
  | 'emailAlreadyRegistered'
  | 'resetPassword'
  | 'passwordChanged'
  // 009 – thư có mã (gửi trong tiến trình sau khi giao dịch xác nhận).
  | 'completeSignup'
  | 'confirmIdentityLink'
  | 'inviteMember'
  | 'setPassword'
  // 009 – thư không mã.
  | 'memberRemoved'
  | NoticeTemplateName;

/** Thư không mã gửi qua việc `account.mail_notice` (contracts/module-api.md mục 5). */
export type NoticeTemplateName =
  | 'identityAdded'
  | 'identityRemoved'
  | 'identityLinkBlocked'
  | 'identityRemovedByProvider'
  | 'inviteAccepted'
  | 'detachedDeletionNotice';

export type LoginMethodKind = 'password' | 'google' | 'facebook';

export interface TemplateVars {
  webBaseUrl: string;
  displayName?: string | undefined;
  /** Mã một lần (verifyEmail, resetPassword, completeSignup, confirmIdentityLink, inviteMember). */
  token?: string | undefined;
  /** Cách đăng nhập liên quan (thư về cách đăng nhập). */
  method?: LoginMethodKind | undefined;
  /** Tên người mời (inviteMember). */
  inviterName?: string | undefined;
  /** Nhãn tài khoản – tên cửa hàng (inviteMember, memberRemoved, inviteAccepted). */
  accountLabel?: string | undefined;
  /** Tên người vừa tham gia (inviteAccepted). */
  subjectName?: string | undefined;
  /** Hạn lời mời (inviteMember) hoặc ngày xóa (detachedDeletionNotice). */
  date?: Date | undefined;
}

const METHOD_LABELS: Record<LoginMethodKind, string> = {
  password: 'mật khẩu',
  google: 'Google',
  facebook: 'Facebook',
};

function methodLabel(vars: TemplateVars): string {
  return METHOD_LABELS[vars.method ?? 'password'];
}

/** Ngày theo giờ Việt Nam (UTC+7), dạng 05/03/2027. */
export function formatDateVi(date: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function requireDate(vars: TemplateVars): string {
  if (vars.date === undefined) throw new Error('Mẫu thư cần ngày');
  return formatDateVi(vars.date);
}

/** Thư ngắn không mã: tiêu đề + các đoạn + (tùy chọn) một nút. */
function plain(
  hello: string,
  subject: string,
  paragraphs: string[],
  link?: { href: string; label: string },
): Content {
  return {
    subject,
    text: [hello, '', ...paragraphs, ...(link ? [`${link.label}: ${link.href}`] : [])].join('\n'),
    html: layout([
      `<p>${escapeHtml(hello)}</p>`,
      ...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
      ...(link ? [button(link.href, link.label)] : []),
    ]),
  };
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

    // ----- 009: thư có mã -----
    case 'completeSignup': {
      const link = `${base}/oauth/confirm#token=${requireToken(vars)}`;
      return plain(
        hello,
        'Hoàn tất đăng ký',
        [
          `Bạn vừa đăng ký bằng ${methodLabel(vars)} với email này. Bấm nút dưới đây để xác nhận email và bắt đầu dùng ứng dụng.`,
          'Liên kết dùng được một lần trong 24 giờ. Nếu bạn không đăng ký, hãy bỏ qua thư này.',
        ],
        { href: link, label: 'Hoàn tất đăng ký' },
      );
    }
    case 'confirmIdentityLink': {
      const link = `${base}/oauth/confirm#token=${requireToken(vars)}`;
      const provider = methodLabel(vars);
      return plain(
        hello,
        `Xác nhận đăng nhập bằng ${provider}`,
        [
          `Có người vừa đăng nhập bằng ${provider} với email của bạn. Email này đã có tài khoản, nên chúng tôi cần bạn xác nhận trước khi liên kết ${provider} với tài khoản đó.`,
          'Liên kết dùng được một lần trong 30 phút.',
          'Nếu không phải bạn làm, hãy bỏ qua thư này – tài khoản của bạn không thay đổi và không ai vào được.',
        ],
        { href: link, label: `Xác nhận và liên kết ${provider}` },
      );
    }
    case 'inviteMember': {
      const link = `${base}/join#token=${requireToken(vars)}`;
      const inviter = vars.inviterName ?? 'Chủ tài khoản';
      const label = vars.accountLabel ?? `tài khoản của ${inviter}`;
      return plain(
        'Xin chào,',
        `${inviter} mời bạn cùng làm việc`,
        [
          `${inviter} mời bạn tham gia ${label} với vai trò cộng tác viên: cùng soạn và chuẩn bị bài đăng.`,
          `Lời mời có hiệu lực đến hết ngày ${requireDate(vars)}.`,
          'Nếu bạn không biết người mời, hãy bỏ qua thư này.',
        ],
        { href: link, label: 'Xem lời mời' },
      );
    }
    case 'setPassword': {
      const link = `${base}/reset-password#token=${requireToken(vars)}`;
      return plain(
        hello,
        'Tạo mật khẩu đăng nhập',
        [
          'Bấm nút dưới đây để tạo mật khẩu cho tài khoản của bạn. Sau đó bạn đăng nhập được bằng email và mật khẩu.',
          'Liên kết dùng được một lần trong 30 phút. Nếu bạn không yêu cầu, hãy bỏ qua thư này.',
        ],
        { href: link, label: 'Tạo mật khẩu' },
      );
    }

    // ----- 009: thư không mã -----
    case 'memberRemoved': {
      const label = vars.accountLabel ?? 'tài khoản bạn đang cộng tác';
      return plain(
        hello,
        'Bạn không còn là thành viên',
        [
          `Bạn không còn là thành viên của ${label}.`,
          'Bạn vẫn đăng nhập được để tạo tài khoản kinh doanh của riêng mình hoặc nhận lời mời mới.',
        ],
        { href: `${base}/login`, label: 'Đăng nhập' },
      );
    }
    case 'identityAdded':
      return plain(
        hello,
        'Bạn vừa thêm một cách đăng nhập',
        [
          `Tài khoản của bạn vừa được thêm cách đăng nhập bằng ${methodLabel(vars)}.`,
          'Nếu không phải bạn làm, hãy vào Cài đặt → Cách đăng nhập để gỡ và liên hệ đội hỗ trợ.',
        ],
        { href: `${base}/settings/login-methods`, label: 'Cách đăng nhập' },
      );
    case 'identityRemoved':
      return plain(
        hello,
        'Bạn vừa gỡ một cách đăng nhập',
        [
          `Cách đăng nhập bằng ${methodLabel(vars)} vừa được gỡ khỏi tài khoản của bạn.`,
          'Nếu không phải bạn làm, hãy đăng nhập bằng cách còn lại và liên hệ đội hỗ trợ.',
        ],
        { href: `${base}/settings/login-methods`, label: 'Cách đăng nhập' },
      );
    case 'identityLinkBlocked': {
      const provider = methodLabel(vars);
      return plain(
        hello,
        `Có người thử đăng nhập bằng ${provider}`,
        [
          `Ai đó vừa thử đăng nhập bằng ${provider} với email của bạn. Tài khoản của bạn đã liên kết một tài khoản ${provider} khác nên không có gì thay đổi.`,
          'Nếu là bạn, hãy đăng nhập bằng cách bạn vẫn dùng.',
        ],
        { href: `${base}/login`, label: 'Đăng nhập' },
      );
    }
    case 'identityRemovedByProvider': {
      const provider = methodLabel(vars);
      return plain(
        hello,
        `Đã gỡ đăng nhập bằng ${provider}`,
        [
          `Theo yêu cầu từ ${provider}, cách đăng nhập bằng ${provider} đã được gỡ khỏi tài khoản của bạn.`,
          'Để vào lại, hãy dùng "Quên mật khẩu" với email này để tạo mật khẩu mới, hoặc đăng nhập bằng cách khác bạn đã liên kết.',
        ],
        { href: `${base}/forgot-password`, label: 'Quên mật khẩu' },
      );
    }
    case 'inviteAccepted': {
      const who = vars.subjectName ?? 'Người bạn mời';
      return plain(
        hello,
        `${who} đã tham gia`,
        [`${who} đã chấp nhận lời mời và trở thành cộng tác viên trong tài khoản của bạn.`],
        { href: `${base}/settings/members`, label: 'Xem thành viên' },
      );
    }
    case 'detachedDeletionNotice':
      return plain(
        hello,
        'Thông tin đăng nhập của bạn sắp bị xóa',
        [
          `Bạn hiện không thuộc tài khoản kinh doanh nào. Thông tin đăng nhập của bạn sẽ bị xóa vào ngày ${requireDate(vars)}.`,
          'Muốn giữ lại, hãy đăng nhập trước ngày đó rồi tạo tài khoản kinh doanh của riêng bạn, hoặc chấp nhận một lời mời.',
        ],
        { href: `${base}/login`, label: 'Đăng nhập' },
      );
  }
}
