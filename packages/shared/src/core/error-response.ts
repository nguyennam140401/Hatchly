import { z } from 'zod';

// Lỗi chuẩn của mọi API (data-model.md mục 2.2, nguyên tắc VI).

export const ErrorAction = z.object({
  kind: z.enum([
    'retry',
    'fix_input',
    'contact_support',
    'navigate',
    // 004: gửi lại thư xác nhận email; nhờ chủ tài khoản (cộng tác viên thiếu quyền).
    'resend_verification',
    'contact_owner',
  ]),
  label: z.string().min(1),
  href: z.string().optional(),
});
export type ErrorAction = z.infer<typeof ErrorAction>;

export const FieldErrorItem = z.object({
  path: z.array(z.string()),
  message: z.string(),
});

export const ErrorResponse = z.object({
  error: z.object({
    /** Mã ổn định cho máy đọc, dạng UPPER_SNAKE_CASE. */
    code: z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/),
    /** Lời giải thích đời thường bằng tiếng Việt, không chứa mã kỹ thuật. */
    message: z.string().min(1),
    /** Mỗi lỗi có ít nhất một hành động khắc phục. */
    actions: z.array(ErrorAction).min(1),
    fieldErrors: z.array(FieldErrorItem).optional(),
    /** Số giây cần chờ trước khi thử lại (429 LOGIN_THROTTLED – 004); trùng tiêu đề `Retry-After`. */
    retryAfterSeconds: z.number().int().positive().optional(),
    /** "Chi tiết cho hỗ trợ": mã theo dõi + mã lỗi gốc (không bao giờ chứa bí mật). */
    support: z.object({
      traceId: z.string().min(1),
      detail: z.string().optional(),
    }),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** Khóa lạc quan: bản ghi vừa được người khác sửa (HTTP 409). */
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  // ----- Xác thực và phân quyền (004, contracts/auth-http-api.md mục 3) -----
  /** 401 – chưa đăng nhập hoặc phiên không hợp lệ/hết hạn. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** 403 – thiếu quyền; thông điệp theo quyền thiếu. */
  FORBIDDEN: 'FORBIDDEN',
  /** 403 – cần xác nhận email trước. */
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  /** 403 – điểm cuối thiếu khai báo truy cập (lỗi lập trình, mặc định từ chối). */
  ACCESS_NOT_DECLARED: 'ACCESS_NOT_DECLARED',
  /** 403 – yêu cầu thay đổi dữ liệu không đến từ nguồn được phép. */
  CSRF_REJECTED: 'CSRF_REJECTED',
  /** 401 – email hoặc mật khẩu chưa đúng (không phân biệt lý do). */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** 429 – đã thử sai quá nhiều lần; kèm `Retry-After`. */
  LOGIN_THROTTLED: 'LOGIN_THROTTLED',
  /** 429 – thao tác quá nhanh. */
  RATE_LIMITED: 'RATE_LIMITED',
  /** 403 – tài khoản/người dùng bị khóa hoặc đang xóa (chỉ sau khi mật khẩu đúng). */
  ACCOUNT_UNAVAILABLE: 'ACCOUNT_UNAVAILABLE',
  /** 400 – liên kết một lần đã hết hạn hoặc đã dùng. */
  TOKEN_INVALID: 'TOKEN_INVALID',
  /** 409 – email đã được xác nhận. */
  EMAIL_ALREADY_VERIFIED: 'EMAIL_ALREADY_VERIFIED',
  /** 403 – lối vào nội bộ không mở cho mạng này. */
  IP_NOT_ALLOWED: 'IP_NOT_ALLOWED',
  /** 409 – tài khoản phải luôn có một chủ. */
  OWNER_REQUIRED: 'OWNER_REQUIRED',
  /** 409 – đã đủ 2 cộng tác viên. */
  SEATS_FULL: 'SEATS_FULL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
