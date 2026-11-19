import type { ConnectErrorCode } from '@app/shared/platform_gateway';

// Bảng lý do kênh → lời giải thích đời thường + hành động khắc phục (010 T038, contracts/meta-tiktok-adapters.md mục 5,
// nguyên tắc VI: mỗi thông báo lỗi kèm ≥ 1 hành động; mã lỗi gốc chỉ ở "Chi tiết cho hỗ trợ").
// MÃ LẠ ⇒ `UNKNOWN` (không đoán). Mặc định ở đây; `publishing.error_mappings` (qua cổng ngược) ghi đè được thông điệp
// mà không cần phát hành.

export type ChannelActionKind = 'reconnect' | 'recheck' | 'disconnect' | 'wait';
export interface ChannelAction {
  kind: ChannelActionKind;
  labelVi: string;
}

export interface ReasonInfo {
  reasonVi: string;
  actionsVi: ChannelAction[];
}

const RECONNECT: ChannelAction = { kind: 'reconnect', labelVi: 'Kết nối lại' };
const RECHECK: ChannelAction = { kind: 'recheck', labelVi: 'Kiểm tra lại' };
const DISCONNECT: ChannelAction = { kind: 'disconnect', labelVi: 'Ngắt kết nối' };
const WAIT: ChannelAction = { kind: 'wait', labelVi: 'Chờ hệ thống tự kiểm tra lại' };

const TABLE: Readonly<Record<string, ReasonInfo>> = {
  TOKEN_EXPIRED: {
    reasonVi: 'Quyền đăng bài đã hết hạn nên bài hẹn giờ sẽ không đăng được.',
    actionsVi: [RECONNECT, DISCONNECT],
  },
  TOKEN_REVOKED: {
    reasonVi: 'Quyền đăng bài đã bị thu hồi trên nền tảng (có thể bạn đã gỡ ứng dụng).',
    actionsVi: [RECONNECT, DISCONNECT],
  },
  TOKEN_EXPIRING: {
    reasonVi: 'Quyền đăng bài sắp hết hạn. Hãy kết nối lại để bài hẹn giờ vẫn đăng được.',
    actionsVi: [RECONNECT],
  },
  SCOPE_MISSING: {
    reasonVi:
      'Còn thiếu quyền đăng bài. Hãy kết nối lại và cho phép tất cả các quyền được yêu cầu.',
    actionsVi: [RECONNECT, RECHECK],
  },
  ROLE_TOO_LOW: {
    reasonVi:
      'Bạn cần là quản trị viên hoặc biên tập viên của Page này. Hãy nhờ quản trị viên Page cấp lại vai trò.',
    actionsVi: [RECHECK, DISCONNECT],
  },
  PAGE_UNAVAILABLE: {
    reasonVi: 'Page không còn truy cập được (đã bị xóa hoặc bạn không còn quyền).',
    actionsVi: [RECONNECT, DISCONNECT],
  },
  NOT_PROFESSIONAL: {
    reasonVi:
      'Tài khoản Instagram cần chuyển sang tài khoản chuyên nghiệp (Business/Creator) và liên kết với một Page.',
    actionsVi: [RECHECK, DISCONNECT],
  },
  PAGE_NOT_LINKED: {
    reasonVi: 'Page chưa liên kết với tài khoản Instagram nào. Hãy liên kết trong cài đặt Page.',
    actionsVi: [RECHECK],
  },
  SOURCE_PAGE_LOST: {
    reasonVi:
      'Page liên kết với tài khoản Instagram này không còn dùng được. Hãy xử lý Page trước.',
    actionsVi: [RECHECK, DISCONNECT],
  },
  FEATURE_OFF: {
    reasonVi: 'Tính năng đang tạm tắt cho tài khoản của bạn.',
    actionsVi: [DISCONNECT],
  },
  NOT_ELIGIBLE: {
    reasonVi: 'Tài khoản này chưa đủ điều kiện để đăng bài tự động.',
    actionsVi: [RECHECK, DISCONNECT],
  },
  APP_NOT_APPROVED: {
    reasonVi: 'Tính năng kết nối đang được chuẩn bị. Hãy liên hệ hỗ trợ nếu bạn cần dùng sớm.',
    actionsVi: [WAIT],
  },
  UNKNOWN: {
    reasonVi: 'Có lỗi chưa rõ nguyên nhân. Hãy thử kiểm tra lại; nếu vẫn lỗi, liên hệ hỗ trợ.',
    actionsVi: [RECHECK, DISCONNECT],
  },
};

/** Lý do + hành động cho `reasonCode` của kênh; mã lạ ⇒ `UNKNOWN`. Mã NULL (kênh bình thường) ⇒ null. */
export function reasonInfo(reasonCode: string | null): ReasonInfo | null {
  if (reasonCode === null) return null;
  return Object.hasOwn(TABLE, reasonCode) ? (TABLE[reasonCode] ?? null) : (TABLE.UNKNOWN ?? null);
}

/** `rawCode` của `ClassifiedError` kiểm tra điều kiện → mã khóa chặn ứng viên ở màn hình chọn. */
export type BlockCode =
  'INELIGIBLE' | 'SCOPE_MISSING' | 'ROLE_TOO_LOW' | 'NOT_PROFESSIONAL' | 'PAGE_NOT_LINKED';

export function blockCodeOf(rawCode: string): BlockCode {
  // `FB:SCOPE_MISSING` → `SCOPE_MISSING`; bản giả dùng `FAKE_PERMISSION_MISSING`, `FAKE_NOT_PROFESSIONAL`…
  const stripped = rawCode.includes(':') ? rawCode.slice(rawCode.indexOf(':') + 1) : rawCode;
  const code = stripped.replace(/^FAKE_/, '').replace(/^PERMISSION_MISSING$/, 'SCOPE_MISSING');
  switch (code) {
    case 'SCOPE_MISSING':
    case '200':
    case '10':
      return 'SCOPE_MISSING';
    case 'ROLE_TOO_LOW':
      return 'ROLE_TOO_LOW';
    case 'NOT_PROFESSIONAL':
      return 'NOT_PROFESSIONAL';
    case 'PAGE_NOT_LINKED':
      return 'PAGE_NOT_LINKED';
    default:
      return 'INELIGIBLE';
  }
}

/** `rawCode` kiểm tra điều kiện → `reasonCode` lưu cho kênh `ineligible` (lọc `[A-Za-z0-9_.:-]{1,64}`). */
export function reasonCodeOf(rawCode: string): string {
  const b = blockCodeOf(rawCode);
  return b === 'INELIGIBLE' ? 'NOT_ELIGIBLE' : b;
}

/** Mã lỗi gọi lại cho kết nối lại thất bại vì điều kiện. */
export function callbackCodeOfBlock(b: BlockCode): ConnectErrorCode {
  return b === 'SCOPE_MISSING' ? 'SCOPE_MISSING' : 'NO_CANDIDATES';
}
