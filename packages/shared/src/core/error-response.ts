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
    // 009: xác nhận lại danh tính rồi tự làm lại thao tác (REAUTH_REQUIRED).
    'reauth',
  ]),
  label: z.string().min(1),
  href: z.string().optional(),
});
export type ErrorAction = z.infer<typeof ErrorAction>;

/** 011: lý do phiên kết thúc – để giao diện chọn thông điệp đúng (hộp đăng nhập lại hay màn kết thúc). */
export const SESSION_END_REASONS = [
  'expired',
  'revoked',
  'password_changed',
  'removed',
  'locked',
] as const;
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

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
    /** 011: chỉ có ở 401 UNAUTHENTICATED khi biết lý do phiên kết thúc; thiếu = coi như `expired`. */
    reason: z.enum(SESSION_END_REASONS).optional(),
    /** Số giây cần chờ trước khi thử lại (429 LOGIN_THROTTLED – 004); trùng tiêu đề `Retry-After`. */
    retryAfterSeconds: z.number().int().positive().optional(),
    /**
     * 012: dữ liệu kèm theo lỗi nghiệp vụ để giao diện hiện đủ hướng xử lý (vd `channelIssues` mọi
     * kênh vướng cùng lúc, `suggestedAt`, bài mới nhất khi `VERSION_CONFLICT`). Không bí mật, không số tiền.
     */
    extra: z.record(z.string(), z.unknown()).optional(),
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
  // ----- Đăng nhập Google/Facebook, cách đăng nhập, lời mời (009, contracts/auth-http-api.md mục 8) -----
  /** 400 – người dùng hủy ở trang của nhà cung cấp. */
  OAUTH_CANCELLED: 'OAUTH_CANCELLED',
  /** 400 – nhà cung cấp trả lỗi hoặc hồ sơ không dùng được. */
  OAUTH_FAILED: 'OAUTH_FAILED',
  /** 400 – lượt đăng nhập hết hạn, sai `state`, lặp lại hoặc thiếu cookie. */
  OAUTH_FLOW_INVALID: 'OAUTH_FLOW_INVALID',
  /** 503 – không gọi được nhà cung cấp; đăng nhập bằng cách khác vẫn chạy. */
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  /** 409 – danh tính nhà cung cấp đã gắn với người dùng khác. */
  IDENTITY_IN_USE: 'IDENTITY_IN_USE',
  /** 409 – người dùng trùng email đã liên kết một tài khoản khác của cùng nhà cung cấp. */
  PROVIDER_ACCOUNT_CONFLICT: 'PROVIDER_ACCOUNT_CONFLICT',
  /** 409 – đã có cách đăng nhập loại này. */
  LOGIN_METHOD_EXISTS: 'LOGIN_METHOD_EXISTS',
  /** 409 – không gỡ được cách đăng nhập cuối cùng. */
  LAST_LOGIN_METHOD: 'LAST_LOGIN_METHOD',
  /** 403 – cần xác nhận lại danh tính (phiên xác nhận quá 10 phút). */
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  /** 400 – danh tính dùng để xác nhận lại không thuộc người dùng này. */
  REAUTH_MISMATCH: 'REAUTH_MISMATCH',
  /** 400 – lời mời hết hạn, đã dùng hoặc đã hủy. */
  INVITE_INVALID: 'INVITE_INVALID',
  /** 409 – email của người chấp nhận khác email được mời. */
  INVITE_EMAIL_MISMATCH: 'INVITE_EMAIL_MISMATCH',
  /** 409 – email được mời đang thuộc một tài khoản khác. */
  INVITE_EMAIL_IN_USE: 'INVITE_EMAIL_IN_USE',
  /** 400 – chủ tài khoản tự mời chính mình. */
  INVITE_SELF: 'INVITE_SELF',
  /** 409 – người gọi đang thuộc một tài khoản thật. */
  ALREADY_IN_ACCOUNT: 'ALREADY_IN_ACCOUNT',
  /** 403 – người gọi không còn thuộc tài khoản nào (tài khoản chờ). */
  NO_ACCOUNT: 'NO_ACCOUNT',
  /** 400 – `signed_request` của Meta sai chữ ký hoặc sai định dạng (máy gọi máy). */
  SIGNED_REQUEST_INVALID: 'SIGNED_REQUEST_INVALID',
  // ----- Bài viết, duyệt, lịch (012, contracts/http-api.md mục 4) -----
  /** 409 – tài khoản chưa có kênh hoạt động. */
  NO_ACTIVE_CHANNEL: 'NO_ACTIVE_CHANNEL',
  /** 409 – bài không sửa/xóa được ở trạng thái hiện tại. */
  POST_NOT_EDITABLE: 'POST_NOT_EDITABLE',
  /** 409 – bài đã được duyệt / đã ở trạng thái đích (gọi lặp). */
  POST_ALREADY_APPROVED: 'POST_ALREADY_APPROVED',
  /** 422 – nội dung vượt giới hạn kênh, thiếu media hoặc bài rỗng. */
  POST_CONTENT_INVALID: 'POST_CONTENT_INVALID',
  /** 422 – giờ đăng quá gần hoặc đã qua. */
  TIME_IN_PAST: 'TIME_IN_PAST',
  /** 409 – kênh đã ngắt hoặc hết hạn quyền. */
  CHANNEL_INACTIVE: 'CHANNEL_INACTIVE',
  /** 409 – kênh hết hạn mức đăng ở giờ đã chọn. */
  CHANNEL_QUOTA_EXCEEDED: 'CHANNEL_QUOTA_EXCEEDED',
  /** 409 – có kênh đã/đang đăng nên không hủy, đổi giờ, sửa được. */
  CHANNEL_ALREADY_PUBLISHING: 'CHANNEL_ALREADY_PUBLISHING',
  /** 403 – gói dịch vụ đã hết hạn. */
  PLAN_EXPIRED: 'PLAN_EXPIRED',
  /** 422 – ghi chú trả lại rỗng hoặc quá 500 ký tự. */
  RETURN_NOTE_REQUIRED: 'RETURN_NOTE_REQUIRED',
  /** 422 – chọn quá số bài cho phép mỗi lần. */
  BULK_LIMIT_EXCEEDED: 'BULK_LIMIT_EXCEEDED',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
