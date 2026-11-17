// Mã lỗi + thông điệp tiếng Việt + hành động khắc phục của thư viện media (014 contracts/media-http-api.md).
// Mỗi thông báo có ít nhất MỘT hành động (nguyên tắc VI). Mã lỗi gốc chỉ ở "Chi tiết cho hỗ trợ".
import type { ErrorAction } from '../../core/error-response.js';

export const MEDIA_ERROR_CODES = [
  'MEDIA_TYPE_UNSUPPORTED',
  'MEDIA_TOO_LARGE',
  'MEDIA_QUOTA_EXCEEDED',
  'MEDIA_PLAN_EXPIRED',
  'UPLOAD_INCOMPLETE',
  'UPLOAD_REJECTED',
  'MEDIA_IN_USE',
  'MEDIA_USED_CONFIRM_REQUIRED',
  'MEDIA_DELETE_NOT_OWNER',
  'STORAGE_UNAVAILABLE',
] as const;
export type MediaErrorCode = (typeof MEDIA_ERROR_CODES)[number];

export interface MediaErrorInfo {
  httpStatus: number;
  message: string;
  actions: [ErrorAction, ...ErrorAction[]];
}

export const MEDIA_ERRORS: Record<MediaErrorCode, MediaErrorInfo> = {
  MEDIA_TYPE_UNSUPPORTED: {
    httpStatus: 400,
    message: 'Loại tệp này chưa được hỗ trợ. Dùng ảnh JPEG, PNG, WebP, HEIC hoặc video MP4, MOV.',
    actions: [{ kind: 'fix_input', label: 'Chọn tệp khác' }],
  },
  MEDIA_TOO_LARGE: {
    httpStatus: 400,
    message:
      'Tệp quá lớn. Ảnh tối đa 20 MB, video tối đa 500 MB – hãy giảm kích thước rồi tải lại.',
    actions: [{ kind: 'fix_input', label: 'Chọn tệp khác' }],
  },
  MEDIA_QUOTA_EXCEEDED: {
    httpStatus: 409,
    message: 'Thư viện đã đầy. Hãy xóa bớt ảnh/video cũ rồi tải lại.',
    actions: [{ kind: 'navigate', label: 'Xem danh sách để xóa', href: '/media' }],
  },
  MEDIA_PLAN_EXPIRED: {
    httpStatus: 403,
    message: 'Gói của bạn đã hết hạn nên chưa tải thêm được. Bạn vẫn xem và xóa được ảnh/video.',
    actions: [{ kind: 'navigate', label: 'Gia hạn gói', href: '/account/plan' }],
  },
  UPLOAD_INCOMPLETE: {
    httpStatus: 409,
    message: 'Tệp chưa lên đủ. Hãy thử tải lại.',
    actions: [{ kind: 'retry', label: 'Thử lại' }],
  },
  UPLOAD_REJECTED: {
    httpStatus: 422,
    message: 'Tệp bị lỗi khi tải hoặc không đúng loại đã chọn. Hãy tải lại tệp này.',
    actions: [{ kind: 'retry', label: 'Tải lại' }],
  },
  MEDIA_IN_USE: {
    httpStatus: 409,
    message: 'Ảnh/video này đang dùng trong bài đã duyệt hoặc đã lên lịch nên chưa xóa được.',
    actions: [{ kind: 'navigate', label: 'Mở bài để đổi media', href: '/posts' }],
  },
  MEDIA_USED_CONFIRM_REQUIRED: {
    httpStatus: 409,
    message: 'Ảnh/video này đang dùng trong một số bài. Hãy xác nhận nếu vẫn muốn xóa.',
    actions: [{ kind: 'retry', label: 'Xác nhận xóa' }],
  },
  MEDIA_DELETE_NOT_OWNER: {
    httpStatus: 403,
    message:
      'Bạn chỉ xóa được ảnh/video do chính mình tải lên. Nhờ chủ tài khoản hoặc người đã tải xóa giúp.',
    actions: [{ kind: 'contact_owner', label: 'Nhờ chủ tài khoản' }],
  },
  STORAGE_UNAVAILABLE: {
    httpStatus: 503,
    message: 'Kho lưu trữ đang bận. Hãy thử lại sau ít phút.',
    actions: [{ kind: 'retry', label: 'Thử lại' }],
  },
};

/** Lý do bác tệp khi xác nhận (`UPLOAD_REJECTED`). */
export const UPLOAD_REJECT_CODES = [
  'size_mismatch',
  'type_mismatch',
  'type_unsupported',
  'animated',
] as const;
export type UploadRejectCode = (typeof UPLOAD_REJECT_CODES)[number];

/** Lý do không xử lý được ở Worker (cột `media.failure_code`). */
export const UNPROCESSABLE_CODES = [
  'corrupt',
  'unsupported',
  'too_many_pixels',
  'animated',
  'no_video_stream',
  'storage_mismatch',
] as const;
export type UnprocessableCode = (typeof UNPROCESSABLE_CODES)[number];

export interface FailureInfo {
  title: string;
  action: string;
}

/** `failure_code` → thông điệp hiển thị trên ô "Không xử lý được" (luôn kèm cách khắc phục). */
export const UNPROCESSABLE_MESSAGES: Record<UnprocessableCode, FailureInfo> = {
  corrupt: {
    title: 'Không xử lý được',
    action: 'Hãy thử xuất lại ảnh từ máy rồi tải lên lại.',
  },
  unsupported: {
    title: 'Không xử lý được',
    action: 'Hãy thử xuất lại ảnh sang JPEG hoặc PNG rồi tải lên lại.',
  },
  too_many_pixels: {
    title: 'Ảnh quá lớn để xử lý',
    action: 'Hãy giảm kích thước ảnh (dưới 50 triệu điểm ảnh) rồi tải lên lại.',
  },
  animated: {
    title: 'Chưa hỗ trợ ảnh động',
    action: 'Hãy dùng ảnh tĩnh hoặc video MP4 rồi tải lên lại.',
  },
  no_video_stream: {
    title: 'Video không có hình',
    action: 'Hãy kiểm tra tệp video rồi tải lên lại.',
  },
  storage_mismatch: {
    title: 'Không xử lý được',
    action: 'Hãy xóa tệp này và tải lên lại.',
  },
};

/** Thông điệp khi một tệp bị bác lúc xác nhận (`UPLOAD_REJECTED` + `failureCode`). */
export const UPLOAD_REJECT_MESSAGES: Record<UploadRejectCode, FailureInfo> = {
  size_mismatch: {
    title: 'Tệp bị lỗi khi tải',
    action: 'Hãy tải lại tệp này.',
  },
  type_mismatch: {
    title: 'Tệp không đúng loại đã chọn',
    action: 'Hãy chọn đúng ảnh hoặc video rồi tải lại.',
  },
  type_unsupported: {
    title: 'Loại tệp này chưa được hỗ trợ',
    action: 'Dùng ảnh JPEG, PNG, WebP, HEIC hoặc video MP4, MOV.',
  },
  animated: UNPROCESSABLE_MESSAGES.animated,
};
