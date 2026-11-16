import { ERROR_CODES } from '@app/shared/core';

// Mã lỗi (ERROR_CODES) → lời giải thích đời thường + hành động khắc phục. Luôn ≥ 1 hành động (nguyên tắc VI);
// mã gốc không hiện ở khu vực chính, chỉ ở "Chi tiết cho hỗ trợ".

export interface ErrorActionView {
  kind:
    | 'retry'
    | 'fix_input'
    | 'contact_support'
    | 'navigate'
    | 'reauth'
    | 'contact_owner'
    | 'resend_verification';
  label: string;
  href?: string | undefined;
}

export interface ErrorExplanation {
  message: string;
  actions: [ErrorActionView, ...ErrorActionView[]];
}

const RETRY: ErrorActionView = { kind: 'retry', label: 'Thử lại' };
const HOME: ErrorActionView = { kind: 'navigate', label: 'Về Tổng quan', href: '/' };
const SUPPORT: ErrorActionView = { kind: 'contact_support', label: 'Liên hệ hỗ trợ' };
const LOGIN: ErrorActionView = { kind: 'navigate', label: 'Đăng nhập', href: '/login' };

export const ERROR_EXPLANATIONS: Record<keyof typeof ERROR_CODES, ErrorExplanation> = {
  VALIDATION_FAILED: {
    message: 'Một số thông tin chưa hợp lệ. Hãy kiểm tra các ô được đánh dấu.',
    actions: [{ kind: 'fix_input', label: 'Sửa thông tin' }],
  },
  NOT_FOUND: { message: 'Không tìm thấy nội dung bạn yêu cầu.', actions: [HOME] },
  SERVICE_UNAVAILABLE: {
    message: 'Hệ thống đang tạm dừng để cập nhật. Vui lòng thử lại sau ít phút.',
    actions: [RETRY],
  },
  INTERNAL_ERROR: {
    message: 'Có lỗi ở phía hệ thống. Bạn thử lại sau ít phút nhé.',
    actions: [RETRY, SUPPORT],
  },
  VERSION_CONFLICT: {
    message: 'Nội dung vừa được người khác thay đổi. Hãy xem bản mới nhất trước khi làm tiếp.',
    actions: [{ kind: 'retry', label: 'Xem bản mới' }],
  },
  UNAUTHENTICATED: { message: 'Bạn cần đăng nhập để tiếp tục.', actions: [LOGIN] },
  FORBIDDEN: {
    message: 'Bạn không có quyền thực hiện thao tác này.',
    actions: [HOME, { kind: 'contact_owner', label: 'Nhờ chủ tài khoản' }],
  },
  EMAIL_NOT_VERIFIED: {
    message: 'Bạn cần xác nhận email trước khi tiếp tục.',
    actions: [{ kind: 'resend_verification', label: 'Gửi lại thư xác nhận' }],
  },
  ACCESS_NOT_DECLARED: { message: 'Chức năng này tạm thời chưa dùng được.', actions: [SUPPORT] },
  CSRF_REJECTED: {
    message: 'Yêu cầu không được chấp nhận. Hãy tải lại trang rồi thử lại.',
    actions: [RETRY],
  },
  INVALID_CREDENTIALS: {
    message: 'Email hoặc mật khẩu chưa đúng.',
    actions: [{ kind: 'fix_input', label: 'Nhập lại' }],
  },
  LOGIN_THROTTLED: {
    message: 'Bạn đã thử sai nhiều lần. Hãy chờ một lát rồi thử lại.',
    actions: [RETRY],
  },
  RATE_LIMITED: {
    message: 'Bạn thao tác hơi nhanh. Hãy chờ một lát rồi thử lại.',
    actions: [RETRY],
  },
  ACCOUNT_UNAVAILABLE: { message: 'Tài khoản hiện chưa dùng được.', actions: [SUPPORT] },
  TOKEN_INVALID: { message: 'Liên kết đã hết hạn hoặc đã được dùng.', actions: [HOME] },
  EMAIL_ALREADY_VERIFIED: { message: 'Email này đã được xác nhận rồi.', actions: [HOME] },
  IP_NOT_ALLOWED: { message: 'Mạng của bạn chưa được phép vào khu vực này.', actions: [SUPPORT] },
  OWNER_REQUIRED: { message: 'Tài khoản luôn phải có một chủ.', actions: [HOME] },
  SEATS_FULL: { message: 'Đã đủ số cộng tác viên cho gói của bạn.', actions: [HOME] },
  OAUTH_CANCELLED: { message: 'Bạn đã hủy đăng nhập.', actions: [LOGIN] },
  OAUTH_FAILED: {
    message: 'Chưa đăng nhập được bằng tài khoản này. Hãy thử cách khác.',
    actions: [LOGIN],
  },
  OAUTH_FLOW_INVALID: { message: 'Lượt đăng nhập đã hết hạn. Hãy bắt đầu lại.', actions: [LOGIN] },
  PROVIDER_UNAVAILABLE: {
    message: 'Dịch vụ đăng nhập đang tạm gián đoạn. Bạn có thể dùng cách đăng nhập khác.',
    actions: [LOGIN],
  },
  IDENTITY_IN_USE: { message: 'Tài khoản này đã gắn với một người dùng khác.', actions: [HOME] },
  PROVIDER_ACCOUNT_CONFLICT: {
    message: 'Email này đã liên kết với một tài khoản khác.',
    actions: [HOME],
  },
  LOGIN_METHOD_EXISTS: { message: 'Bạn đã có cách đăng nhập này rồi.', actions: [HOME] },
  LAST_LOGIN_METHOD: { message: 'Không thể gỡ cách đăng nhập cuối cùng.', actions: [HOME] },
  REAUTH_REQUIRED: {
    message: 'Hãy xác nhận lại danh tính để tiếp tục.',
    actions: [{ kind: 'reauth', label: 'Xác nhận lại' }],
  },
  REAUTH_MISMATCH: { message: 'Danh tính xác nhận không khớp với tài khoản.', actions: [RETRY] },
  INVITE_INVALID: { message: 'Lời mời đã hết hạn hoặc không còn dùng được.', actions: [HOME] },
  INVITE_EMAIL_MISMATCH: { message: 'Email khác với email được mời.', actions: [HOME] },
  INVITE_EMAIL_IN_USE: {
    message: 'Email được mời đang thuộc một tài khoản khác.',
    actions: [HOME],
  },
  INVITE_SELF: { message: 'Bạn không thể tự mời chính mình.', actions: [HOME] },
  ALREADY_IN_ACCOUNT: { message: 'Bạn đang thuộc một tài khoản rồi.', actions: [HOME] },
  NO_ACCOUNT: {
    message: 'Bạn chưa thuộc tài khoản nào.',
    actions: [{ kind: 'navigate', label: 'Xem lựa chọn của bạn', href: '/no-account' }],
  },
  SIGNED_REQUEST_INVALID: { message: 'Yêu cầu không hợp lệ.', actions: [HOME] },
  // ----- 012: bài viết, duyệt, lịch (khớp POST_ERROR_MESSAGES của @app/shared/core) -----
  NO_ACTIVE_CHANNEL: {
    message: 'Bạn chưa có kênh nào đang hoạt động. Hãy kết nối kênh để bắt đầu soạn bài.',
    actions: [{ kind: 'navigate', label: 'Kết nối kênh', href: '/channels' }],
  },
  POST_NOT_EDITABLE: {
    message: 'Bài này không sửa được ở trạng thái hiện tại.',
    actions: [{ kind: 'retry', label: 'Tải lại bài' }],
  },
  POST_ALREADY_APPROVED: {
    message: 'Bài này đã được xử lý trước đó.',
    actions: [{ kind: 'navigate', label: 'Mở bài', href: '/posts' }],
  },
  POST_CONTENT_INVALID: {
    message: 'Nội dung bài chưa phù hợp với kênh đã chọn. Hãy sửa rồi thử lại.',
    actions: [{ kind: 'fix_input', label: 'Sửa nội dung' }],
  },
  TIME_IN_PAST: {
    message: 'Giờ đăng đã qua hoặc quá gần. Hãy chọn giờ muộn hơn ít nhất 5 phút.',
    actions: [{ kind: 'fix_input', label: 'Chọn giờ khác' }],
  },
  CHANNEL_INACTIVE: {
    message: 'Có kênh đã ngắt kết nối hoặc hết hạn quyền, nên chưa lên lịch được.',
    actions: [{ kind: 'navigate', label: 'Kết nối lại', href: '/channels' }],
  },
  CHANNEL_QUOTA_EXCEEDED: {
    message: 'Kênh này đã hết số bài được đăng trong khung giờ đó.',
    actions: [{ kind: 'fix_input', label: 'Chọn giờ khác' }],
  },
  CHANNEL_ALREADY_PUBLISHING: {
    message: 'Bài này đã bắt đầu được đăng lên kênh nên không thay đổi được nữa.',
    actions: [{ kind: 'navigate', label: 'Xem tiến trình', href: '/posts' }],
  },
  PLAN_EXPIRED: {
    message: 'Gói dịch vụ của bạn đã hết hạn. Hãy gia hạn để duyệt và lên lịch bài.',
    actions: [{ kind: 'navigate', label: 'Gia hạn gói', href: '/plan' }],
  },
  RETURN_NOTE_REQUIRED: {
    message: 'Hãy nhập ghi chú trả lại (tối đa 500 ký tự) để người soạn biết cần sửa gì.',
    actions: [{ kind: 'fix_input', label: 'Nhập ghi chú' }],
  },
  BULK_LIMIT_EXCEEDED: {
    message: 'Bạn đã chọn quá nhiều bài cho một lần. Hãy chia nhỏ lựa chọn.',
    actions: [{ kind: 'fix_input', label: 'Chia nhỏ lựa chọn' }],
  },
};

/** Hành động dự phòng khi máy chủ không trả hành động nào. */
export const FALLBACK_ACTIONS: [ErrorActionView, ...ErrorActionView[]] = [RETRY, HOME];

export function explain(code: string): ErrorExplanation | undefined {
  return (ERROR_EXPLANATIONS as Record<string, ErrorExplanation | undefined>)[code];
}
