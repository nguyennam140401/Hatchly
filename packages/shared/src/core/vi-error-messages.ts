import type { z } from 'zod';

/** Một lỗi kiểm tra đầu vào gắn với một ô (đường dẫn trường). */
export interface FieldError {
  path: string[];
  message: string;
}

// Hàm thuần dịch lỗi Zod sang tiếng Việt (R8).
// KHÔNG dùng z.config() hay bất kỳ đăng ký toàn cục nào: gói đặt `sideEffects: false`, bundler có
// thể loại đoạn đăng ký và web sẽ ra thông điệp tiếng Anh. Dịch lúc chuyển đổi nên web và API luôn
// ra cùng thông điệp, không phụ thuộc thứ tự nạp mô-đun.

type Issue = z.core.$ZodIssue;

const REQUIRED = 'Vui lòng nhập nội dung.';
const FALLBACK = 'Giá trị chưa hợp lệ.';

const TYPE_LABELS: Partial<Record<string, string>> = {
  string: 'Vui lòng nhập dạng chữ.',
  number: 'Vui lòng nhập một số.',
  int: 'Vui lòng nhập số nguyên.',
  bigint: 'Vui lòng nhập số nguyên.',
  boolean: 'Vui lòng chọn có hoặc không.',
  date: 'Vui lòng nhập ngày hợp lệ.',
  array: 'Vui lòng nhập danh sách.',
  object: 'Thông tin chưa đúng cấu trúc.',
};

const FORMAT_LABELS: Partial<Record<string, string>> = {
  uuid: 'Mã định danh không hợp lệ.',
  guid: 'Mã định danh không hợp lệ.',
  datetime: 'Thời gian không đúng định dạng (ví dụ 2026-11-08T03:00:00Z).',
  date: 'Ngày không đúng định dạng (ví dụ 2026-11-08).',
  time: 'Giờ không đúng định dạng (ví dụ 03:00:00).',
  email: 'Email không hợp lệ.',
  url: 'Đường dẫn không hợp lệ.',
};

/**
 * Trường bị thiếu: Zod 4 không giữ `input` trong issue (trừ khi bật reportInput), nhưng thông điệp
 * gốc (locale mặc định, không cấu hình toàn cục) luôn kết thúc bằng "received undefined".
 * Phiên bản Zod được khóa chính xác; kiểm thử core.spec.ts bắt nếu hành vi đổi.
 */
function isMissing(issue: Issue): boolean {
  if (issue.input !== undefined) return false;
  return issue.message.endsWith('received undefined');
}

function translate(issue: Issue): string {
  switch (issue.code) {
    case 'invalid_type':
      if (isMissing(issue)) return REQUIRED;
      return TYPE_LABELS[issue.expected] ?? 'Giá trị không đúng kiểu.';
    case 'too_small': {
      const min = Number(issue.minimum);
      if (issue.origin === 'string') {
        return min <= 1 ? REQUIRED : `Vui lòng nhập ít nhất ${min} ký tự.`;
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        return `Cần ít nhất ${min} mục.`;
      }
      return issue.inclusive === false
        ? `Giá trị phải lớn hơn ${min}.`
        : `Giá trị không được nhỏ hơn ${min}.`;
    }
    case 'too_big': {
      const max = Number(issue.maximum);
      if (issue.origin === 'string') return `Tối đa ${max} ký tự.`;
      if (issue.origin === 'array' || issue.origin === 'set') return `Tối đa ${max} mục.`;
      return issue.inclusive === false
        ? `Giá trị phải nhỏ hơn ${max}.`
        : `Giá trị không được lớn hơn ${max}.`;
    }
    case 'invalid_format':
      return FORMAT_LABELS[issue.format] ?? 'Giá trị không đúng định dạng.';
    case 'invalid_value':
      return 'Vui lòng chọn một giá trị trong danh sách.';
    case 'not_multiple_of':
      return `Giá trị phải là bội số của ${issue.divisor}.`;
    case 'unrecognized_keys':
      return 'Có thông tin không được hỗ trợ.';
    case 'custom': {
      // Chỉ dùng thông điệp do lược đồ chủ động đặt bằng `viIssue` (006) – thông điệp mặc định
      // tiếng Anh của Zod ("Invalid input") không bao giờ lọt ra người dùng.
      const vi = (issue.params as { viMessage?: unknown } | undefined)?.viMessage;
      return typeof vi === 'string' && vi !== '' ? vi : FALLBACK;
    }
    default:
      return FALLBACK;
  }
}

/**
 * Thông điệp tiếng Việt đời thường cho mã lỗi của xác thực (004, contracts/auth-http-api.md mục 3).
 * API và web dùng chung để luôn ra cùng câu chữ. `{n}` trong `LOGIN_THROTTLED` là số phút còn lại.
 * `FORBIDDEN` có thông điệp riêng theo quyền thiếu (máy chủ); đây là câu mặc định.
 */
export const AUTH_ERROR_MESSAGES = {
  UNAUTHENTICATED: 'Bạn cần đăng nhập để tiếp tục.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  EMAIL_NOT_VERIFIED: 'Hãy xác nhận email để tiếp tục.',
  ACCESS_NOT_DECLARED: 'Chức năng này tạm thời không dùng được.',
  CSRF_REJECTED: 'Yêu cầu không hợp lệ. Hãy tải lại trang và thử lại.',
  INVALID_CREDENTIALS: 'Email hoặc mật khẩu chưa đúng.',
  LOGIN_THROTTLED: 'Bạn đã thử sai nhiều lần. Hãy thử lại sau {n} phút hoặc đặt lại mật khẩu.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh. Hãy thử lại sau ít phút.',
  ACCOUNT_UNAVAILABLE: 'Tài khoản này đang tạm khóa hoặc đang được xóa.',
  TOKEN_INVALID: 'Liên kết đã hết hạn hoặc đã được dùng.',
  EMAIL_ALREADY_VERIFIED: 'Email của bạn đã được xác nhận.',
  IP_NOT_ALLOWED: 'Lối vào nội bộ không mở cho mạng này.',
  OWNER_REQUIRED: 'Tài khoản phải luôn có một chủ tài khoản.',
  SEATS_FULL: 'Đã đủ 2 cộng tác viên. Gỡ một người hoặc hủy một lời mời để mời người khác.',
  // ----- 009 (contracts/auth-http-api.md mục 8). `{provider}` = Google/Facebook, `{email}` = email được mời.
  OAUTH_CANCELLED: 'Bạn chưa hoàn tất đăng nhập bằng {provider}.',
  OAUTH_FAILED: 'Chưa đăng nhập được bằng {provider}. Hãy thử lại hoặc đăng nhập bằng email.',
  OAUTH_FLOW_INVALID: 'Phiên đăng nhập này đã hết hạn. Hãy bắt đầu lại.',
  PROVIDER_UNAVAILABLE: '{provider} đang gặp sự cố. Bạn có thể đăng nhập bằng cách khác.',
  IDENTITY_IN_USE: 'Tài khoản {provider} này đang dùng cho một tài khoản khác.',
  PROVIDER_ACCOUNT_CONFLICT:
    'Email này đã liên kết với một tài khoản {provider} khác. Hãy đăng nhập bằng cách bạn vẫn dùng.',
  LOGIN_METHOD_EXISTS: 'Bạn đã liên kết cách đăng nhập này rồi.',
  LAST_LOGIN_METHOD: 'Hãy thêm cách đăng nhập khác trước khi gỡ.',
  REAUTH_REQUIRED: 'Hãy xác nhận lại đây là bạn để tiếp tục.',
  REAUTH_MISMATCH: 'Tài khoản {provider} vừa chọn không phải cách đăng nhập của bạn.',
  INVITE_INVALID: 'Lời mời không còn hiệu lực. Hãy nhờ chủ tài khoản gửi lại lời mời.',
  INVITE_EMAIL_MISMATCH:
    'Hãy dùng tài khoản có email {email} hoặc nhờ chủ tài khoản mời lại bằng email này.',
  INVITE_EMAIL_IN_USE: 'Email này đang dùng cho một tài khoản khác nên chưa tham gia được.',
  INVITE_SELF: 'Bạn đang là chủ tài khoản này.',
  ALREADY_IN_ACCOUNT: 'Bạn đang thuộc một tài khoản khác.',
  NO_ACCOUNT: 'Bạn không còn là thành viên của tài khoản nào.',
  SIGNED_REQUEST_INVALID: 'Yêu cầu không hợp lệ.',
} as const;
export type AuthErrorCode = keyof typeof AUTH_ERROR_MESSAGES;

/**
 * Thông điệp mặc định của mã lỗi bài viết/duyệt/lịch (012, contracts/http-api.md mục 4). Mỗi mã có
 * hành động khắc phục đi kèm ở máy chủ (`post-errors.ts`) và web.
 */
export const POST_ERROR_MESSAGES = {
  NO_ACTIVE_CHANNEL: 'Bạn chưa có kênh nào đang hoạt động. Hãy kết nối kênh để bắt đầu soạn bài.',
  POST_NOT_EDITABLE: 'Bài này không sửa được ở trạng thái hiện tại.',
  POST_ALREADY_APPROVED: 'Bài này đã được xử lý trước đó.',
  POST_CONTENT_INVALID: 'Nội dung bài chưa phù hợp với kênh đã chọn. Hãy sửa rồi thử lại.',
  TIME_IN_PAST: 'Giờ đăng đã qua hoặc quá gần. Hãy chọn giờ muộn hơn ít nhất 5 phút.',
  CHANNEL_INACTIVE: 'Có kênh đã ngắt kết nối hoặc hết hạn quyền, nên chưa lên lịch được.',
  CHANNEL_QUOTA_EXCEEDED: 'Kênh này đã hết số bài được đăng trong khung giờ đó.',
  CHANNEL_ALREADY_PUBLISHING: 'Bài này đã bắt đầu được đăng lên kênh nên không thay đổi được nữa.',
  PLAN_EXPIRED: 'Gói dịch vụ của bạn đã hết hạn. Hãy gia hạn để duyệt và lên lịch bài.',
  RETURN_NOTE_REQUIRED:
    'Hãy nhập ghi chú trả lại (tối đa 500 ký tự) để người soạn biết cần sửa gì.',
  BULK_LIMIT_EXCEEDED: 'Bạn đã chọn quá nhiều bài cho một lần. Hãy chia nhỏ lựa chọn.',
} as const;
export type PostErrorCode = keyof typeof POST_ERROR_MESSAGES;

/** Thông điệp `LOGIN_THROTTLED` với số phút còn lại (làm tròn lên, tối thiểu 1). */
export function loginThrottledMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return AUTH_ERROR_MESSAGES.LOGIN_THROTTLED.replace('{n}', String(minutes));
}

/** Tên hiển thị của nhà cung cấp đăng nhập trong thông điệp (009). */
export const LOGIN_PROVIDER_LABELS = { google: 'Google', facebook: 'Facebook' } as const;
export type LoginProvider = keyof typeof LOGIN_PROVIDER_LABELS;

/**
 * Thông điệp có chỗ trống `{provider}` / `{email}` (009). Thiếu giá trị → dùng cách nói chung để câu
 * vẫn đọc được.
 */
export function authErrorMessage(
  code: AuthErrorCode,
  vars: { provider?: LoginProvider | undefined; email?: string | undefined } = {},
): string {
  const provider =
    vars.provider === undefined ? 'nhà cung cấp' : LOGIN_PROVIDER_LABELS[vars.provider];
  return AUTH_ERROR_MESSAGES[code]
    .replace('{provider}', provider)
    .replace('{email}', vars.email ?? 'được mời');
}

/**
 * Lỗi tùy chỉnh có thông điệp tiếng Việt (dùng trong `superRefine`): `ctx.addIssue(viIssue(msg, path))`.
 * `toFieldErrors` giữ nguyên thông điệp này – web và API ra cùng câu chữ.
 */
export function viIssue(
  message: string,
  path: (string | number)[] = [],
): { code: 'custom'; message: string; path: (string | number)[]; params: { viMessage: string } } {
  return { code: 'custom', message, path, params: { viMessage: message } };
}

/** Chuyển lỗi Zod thành danh sách lỗi theo ô, thông điệp tiếng Việt. */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)),
    message: translate(issue),
  }));
}
