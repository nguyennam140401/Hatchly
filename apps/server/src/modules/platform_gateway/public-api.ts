/**
 * Giao diện công khai của module Cổng nền tảng (`platform_gateway`) – 005, contracts/platform-gateway.md.
 *
 * Trách nhiệm (ADD mục 6): Kết nối kênh (Facebook Page, Instagram, Zalo OA), mã quyền truy cập mã hóa
 * (chỉ module này giải mã), bộ chuyển đổi mỗi nền tảng sau giao diện chung (ADR-05).
 *
 * Mọi thao tác theo `connectionId` trong tài khoản của ngữ cảnh – KHÔNG nhận `accountId`, KHÔNG trả mã
 * quyền. Kết quả nghiệp vụ là hợp đóng có `kind`; chỉ lỗi lập trình/hạ tầng mới ném (research R1).
 * Bên gọi rẽ nhánh theo `capabilities`, không theo tên nền tảng.
 */

export const CHANNEL_TYPES = ['facebook_page', 'instagram', 'zalo_oa', 'test_channel'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export interface ChannelCapabilities {
  /** false → `reconcile` luôn `unsupported`. */
  reconcile: boolean;
  /** true → `submit` có thể trả `processing`. */
  asyncProcessing: boolean;
  /** false → `refreshToken` trả `user_action` "Kết nối lại". */
  tokenRefresh: boolean;
  /** `checkAccount.quotaRemaining` có giá trị. */
  reportsQuota: boolean;
  /** Khoảng tìm kiếm đối soát tối đa; vượt → `unsupported/window_too_large`. */
  maxReconcileWindowHours: number | null;
}

export interface MediaRules {
  maxItems: number;
  image: {
    formats: ('jpeg' | 'png' | 'webp')[];
    maxBytes: number;
    minAspect: number;
    maxAspect: number;
  } | null;
  video: {
    formats: ('mp4' | 'mov')[];
    maxBytes: number;
    maxDurationSec: number;
    minAspect: number;
    maxAspect: number;
  } | null;
  allowMixed: boolean;
}

export interface MediaDescriptor {
  mediaId: string;
  kind: 'image' | 'video';
  format: string;
  bytes: number;
  width: number;
  height: number;
  durationSec?: number;
}

export type MediaRule = 'format' | 'size' | 'duration' | 'aspect' | 'count' | 'mixed';

export interface MediaViolation {
  mediaId: string | null;
  rule: MediaRule;
  messageVi: string;
  limit: number | string;
  actual: number | string;
}

/** Tối đa của nền tảng rộng nhất (Facebook). Từng kênh có giới hạn riêng trong `mediaRules`. */
export const MAX_POST_TEXT_LENGTH = 63_206;

export interface SubmitRequest {
  connectionId: string;
  /** ≤ 63 206 ký tự. */
  text: string;
  media: { url: string; kind: 'image' | 'video'; mediaId: string }[];
  /** Phải bằng `contentHash(channelType, text)` – lệch → InvalidRequestError. */
  contentHash: string;
  traceId?: string;
}

export type ErrorCategory = 'transient' | 'user_action' | 'unknown';

export type RemedyAction =
  | 'reconnect'
  | 'retry_later'
  | 'edit_media'
  | 'edit_text'
  | 'check_on_platform'
  | 'contact_support';

export interface ClassifiedError {
  category: ErrorCategory;
  /** Đã lọc `[A-Za-z0-9_.:-]{1,64}`. */
  rawCode: string;
  channelType: ChannelType;
  messageVi: string;
  /** ≥ 1 cách khắc phục (nguyên tắc VI). */
  remedies: [
    { action: RemedyAction; labelVi: string },
    ...{ action: RemedyAction; labelVi: string }[],
  ];
  /** Chỉ với `transient`. */
  retryAfterSec?: number;
}

export type SubmitResult =
  | { kind: 'published'; platformPostId: string; permalink: string }
  | { kind: 'processing'; processingId: string }
  | { kind: 'failed'; error: ClassifiedError };

export type CheckStatusResult =
  | { kind: 'processing' }
  | { kind: 'done'; platformPostId: string; permalink: string }
  | { kind: 'failed'; error: ClassifiedError };

export interface ReconcileRequest {
  connectionId: string;
  contentHash: string;
  from: Date;
  to: Date;
}

export type ReconcileResult =
  | { kind: 'found'; platformPostId: string; permalink: string }
  | { kind: 'not_found' }
  | { kind: 'unsupported'; reason: 'capability' | 'window_too_large' | 'platform_unavailable' };

/** Dòng ánh xạ lỗi do Đăng bài sở hữu (WBS 2.4) – cổng không đọc bảng của Đăng bài. */
export interface ErrorMappingRow {
  channelType: ChannelType;
  rawCode: string;
  category: ErrorCategory;
  messageVi: string;
  remedies: ClassifiedError['remedies'];
}

/**
 * Hạn của quyền truy cập (010 R2): `none` = nền tảng không có mốc hạn cố định (Meta, sẽ báo ngay nếu bị thu hồi);
 * `token` = hạn của mã quyền; `data_access` = hạn truy cập dữ liệu (mốc nhỏ hơn quyết định).
 */
export type ExpiryInfo = { kind: 'none' } | { kind: 'token' | 'data_access'; expiresAt: Date };

export type AccountCheckResult =
  | {
      kind: 'eligible';
      accountType: string;
      grantedScopes: string[];
      quotaRemaining: number | null;
      /** Giữ cho 005/012/013; với `expiry.kind='none'` là mốc xa mặc định – dùng `expiry` khi có. */
      tokenExpiresAt: Date;
      /** 010: hạn chính xác. Thiếu = bộ chuyển đổi cũ, hiểu là `{kind:'token', expiresAt: tokenExpiresAt}`. */
      expiry?: ExpiryInfo;
    }
  | { kind: 'ineligible'; error: ClassifiedError };

export type RefreshTokenResult =
  { kind: 'refreshed'; tokenExpiresAt: Date } | { kind: 'failed'; error: ClassifiedError };

export type ChannelConnectionStatus = 'active' | 'expiring' | 'expired' | 'disconnected';

/** Kết nối kênh (hợp đồng liệt kê – không mã quyền). `expiring` = còn < 7 ngày. */
export interface ChannelConnection {
  connectionId: string;
  channelType: ChannelType;
  /** ≤ 120 ký tự. */
  displayName: string;
  externalId: string;
  status: ChannelConnectionStatus;
  tokenExpiresAt: Date;
  connectedAt: Date;
}

export interface PlatformGatewayPublicApi {
  // --- 7 thao tác ADR-05, theo kết nối kênh ---
  checkAccount(connectionId: string): Promise<AccountCheckResult>;
  mediaRules(connectionId: string): Promise<{ channelType: ChannelType; rules: MediaRules }>;
  submit(req: SubmitRequest): Promise<SubmitResult>;
  checkStatus(connectionId: string, processingId: string): Promise<CheckStatusResult>;
  reconcile(req: ReconcileRequest): Promise<ReconcileResult>;
  /** Thuần, đồng bộ. Mã lạ → `unknown`. */
  classifyError(channelType: ChannelType, rawCode: string): ClassifiedError;
  refreshToken(connectionId: string): Promise<RefreshTokenResult>;
  // --- phụ trợ ---
  capabilities(channelType: ChannelType): ChannelCapabilities;
  contentHash(channelType: ChannelType, text: string): string;
  getConnection(connectionId: string): Promise<ChannelConnection | null>;
  /** 012: mọi kết nối của tài khoản trong ngữ cảnh (kể cả đã ngắt) – không mã quyền. */
  listConnections(): Promise<ChannelConnection[]>;
}

/** Token NestJS của PlatformGatewayPublicApi. */
export const PLATFORM_GATEWAY = Symbol('PLATFORM_GATEWAY');
