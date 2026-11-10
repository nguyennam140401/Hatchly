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
  SEATS_FULL: 'Tài khoản đã đủ 2 cộng tác viên.',
} as const;
export type AuthErrorCode = keyof typeof AUTH_ERROR_MESSAGES;

/** Thông điệp `LOGIN_THROTTLED` với số phút còn lại (làm tròn lên, tối thiểu 1). */
export function loginThrottledMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return AUTH_ERROR_MESSAGES.LOGIN_THROTTLED.replace('{n}', String(minutes));
}

/** Chuyển lỗi Zod thành danh sách lỗi theo ô, thông điệp tiếng Việt. */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)),
    message: translate(issue),
  }));
}
