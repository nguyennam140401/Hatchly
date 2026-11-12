import type { ChannelCapabilities, ChannelType, MediaRules } from '../../public-api';
import type { ErrorTable } from '../adapters/classify';

// Năng lực + quy tắc media + bảng mã lỗi của các kênh GIẢ (005, research R3, contracts/platform-gateway.md
// mục 4). Kênh thứ tư `test_channel` (US2) khai báo ở đây cùng một dòng đăng ký trong registry.ts.

export interface FakeChannelSpec {
  capabilities: ChannelCapabilities;
  mediaRules: MediaRules;
  accountType: string;
}

const MB = 1_000_000;

const PHOTO_VIDEO: MediaRules = {
  maxItems: 10,
  image: { formats: ['jpeg', 'png', 'webp'], maxBytes: 8 * MB, minAspect: 0.5, maxAspect: 2 },
  video: { formats: ['mp4', 'mov'], maxBytes: 1000 * MB, maxDurationSec: 1200, minAspect: 0.5, maxAspect: 2 },
  allowMixed: true,
};

export const FAKE_CHANNELS: Partial<Record<ChannelType, FakeChannelSpec>> = {
  facebook_page: {
    capabilities: {
      reconcile: true,
      asyncProcessing: false,
      tokenRefresh: true,
      reportsQuota: true,
      maxReconcileWindowHours: 168,
    },
    mediaRules: PHOTO_VIDEO,
    accountType: 'page',
  },
  instagram: {
    capabilities: {
      reconcile: true,
      asyncProcessing: true,
      tokenRefresh: true,
      reportsQuota: true,
      maxReconcileWindowHours: 168,
    },
    mediaRules: {
      maxItems: 10,
      image: { formats: ['jpeg'], maxBytes: 8 * MB, minAspect: 0.8, maxAspect: 1.91 },
      video: { formats: ['mp4', 'mov'], maxBytes: 300 * MB, maxDurationSec: 900, minAspect: 0.5625, maxAspect: 1.91 },
      allowMixed: true,
    },
    accountType: 'professional',
  },
  zalo_oa: {
    capabilities: {
      reconcile: false,
      asyncProcessing: false,
      tokenRefresh: true,
      reportsQuota: false,
      maxReconcileWindowHours: null,
    },
    mediaRules: {
      maxItems: 5,
      image: { formats: ['jpeg', 'png'], maxBytes: 5 * MB, minAspect: 0.5, maxAspect: 2 },
      video: null,
      allowMixed: false,
    },
    accountType: 'official_account',
  },
  // Kênh thứ tư (US2, SC-002): năng lực tối thiểu, quy tắc media khác (chỉ PNG, tối đa 1).
  test_channel: {
    capabilities: {
      reconcile: false,
      asyncProcessing: false,
      tokenRefresh: false,
      reportsQuota: false,
      maxReconcileWindowHours: null,
    },
    mediaRules: {
      maxItems: 1,
      image: { formats: ['png'], maxBytes: 2 * MB, minAspect: 0.5, maxAspect: 2 },
      video: null,
      allowMixed: false,
    },
    accountType: 'test',
  },
};

/** Bảng mã lỗi giả – mặc định phân loại (contracts/platform-gateway.md mục 4). */
export const FAKE_ERROR_TABLE: ErrorTable = {
  FAKE_RATE_LIMIT: {
    category: 'transient',
    messageVi: 'Nền tảng đang giới hạn số lần đăng. Hệ thống sẽ tự thử lại sau ít phút.',
    remedies: [{ action: 'retry_later', labelVi: 'Thử lại sau' }],
    retryAfterSec: 60,
  },
  FAKE_NETWORK_BEFORE_SEND: {
    category: 'transient',
    messageVi: 'Mất kết nối trước khi gửi bài. Hệ thống sẽ tự thử lại.',
    remedies: [{ action: 'retry_later', labelVi: 'Thử lại sau' }],
  },
  FAKE_TOKEN_EXPIRED: {
    category: 'user_action',
    messageVi: 'Quyền đăng bài lên kênh đã hết hạn. Vui lòng kết nối lại kênh.',
    remedies: [{ action: 'reconnect', labelVi: 'Kết nối lại kênh' }],
  },
  FAKE_PERMISSION_MISSING: {
    category: 'user_action',
    messageVi: 'Ứng dụng chưa được cấp đủ quyền đăng bài. Vui lòng kết nối lại và cấp đủ quyền.',
    remedies: [{ action: 'reconnect', labelVi: 'Kết nối lại kênh' }],
  },
  FAKE_MEDIA_REJECTED: {
    category: 'user_action',
    messageVi: 'Nền tảng không nhận ảnh/video này. Vui lòng đổi tệp khác.',
    remedies: [{ action: 'edit_media', labelVi: 'Đổi ảnh/video' }],
  },
  FAKE_TEXT_TOO_LONG: {
    category: 'user_action',
    messageVi: 'Nội dung bài quá dài so với giới hạn của kênh. Vui lòng rút gọn.',
    remedies: [{ action: 'edit_text', labelVi: 'Sửa nội dung' }],
  },
  FAKE_SERVER_ERROR_AFTER_SEND: {
    category: 'unknown',
    messageVi: 'Nền tảng báo lỗi sau khi đã nhận bài. Chưa rõ bài đã lên hay chưa – vui lòng kiểm tra trên trang.',
    remedies: [{ action: 'check_on_platform', labelVi: 'Kiểm tra trên trang' }],
  },
  FAKE_NOT_PROFESSIONAL: {
    category: 'user_action',
    messageVi: 'Tài khoản này không phải tài khoản chuyên nghiệp nên không đăng bài tự động được.',
    remedies: [{ action: 'reconnect', labelVi: 'Chọn tài khoản khác' }],
  },
};

/** Page/tài khoản giả mặc định sau lượt gọi lại: 2 đủ điều kiện + 1 không đủ. */
export interface FakePage {
  externalId: string;
  displayName: string;
  eligible: boolean;
}

export function defaultFakePages(channelType: ChannelType): FakePage[] {
  const label =
    channelType === 'instagram' ? 'Tài khoản' : channelType === 'zalo_oa' ? 'OA' : 'Trang';
  return [
    { externalId: `${channelType}-1001`, displayName: `${label} Cà phê Gió`, eligible: true },
    { externalId: `${channelType}-1002`, displayName: `${label} Tiệm bánh Mây`, eligible: true },
    { externalId: `${channelType}-1003`, displayName: `${label} cá nhân`, eligible: false },
  ];
}
