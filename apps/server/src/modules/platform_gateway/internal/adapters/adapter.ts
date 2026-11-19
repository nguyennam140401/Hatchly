import type {
  AccountCheckResult,
  ExpiryInfo,
  ChannelCapabilities,
  ChannelType,
  CheckStatusResult,
  ClassifiedError,
  MediaRules,
  ReconcileResult,
  RefreshTokenResult,
  SubmitResult,
} from '../../public-api';
import type { DecryptedCredential } from '../vault/credential-vault';

// Giao diện nội bộ của bộ chuyển đổi nền tảng (005, contracts/platform-gateway.md mục 2, ADR-05).
// Bộ chuyển đổi nhận mã quyền ĐÃ GIẢI MÃ từ CredentialVault – không bao giờ từ bên gọi. Thêm nền tảng =
// thêm một bộ chuyển đổi + một dòng đăng ký trong registry.ts; KHÔNG sửa luồng đăng chính.

/** Ngữ cảnh mỗi lời gọi bộ chuyển đổi (mã kết nối – để ghi nhật ký/tra trạng thái phía nền tảng). */
export interface AdapterCallContext {
  connectionId: string;
  /** Mã Page/tài khoản trên nền tảng (013 – bộ chuyển đổi thật gọi `/{externalId}/…`). */
  externalId?: string | undefined;
}

/**
 * 010 T061: kết quả làm mới quyền NỘI BỘ (mang mã mới – KHÔNG đi qua `PlatformGateway` công khai). Bên gọi (việc nền
 * `check_connection`) mã hóa ngay `accessToken`/`refreshToken` rồi ghi `token_issued_at` mới; không bao giờ ghi nhật ký.
 */
export type RenewTokenResult =
  | { kind: 'renewed'; accessToken: string; refreshToken?: string; expiry: ExpiryInfo }
  | { kind: 'failed'; error: ClassifiedError };

export interface AdapterSubmit {
  text: string;
  media: { url: string; kind: 'image' | 'video'; mediaId: string }[];
  contentHash: string;
  /** Mã kết nối (bản giả lập ghi bài theo kết nối). */
  connectionId: string;
  /** Mã Page/tài khoản trên nền tảng. */
  externalId?: string | undefined;
  /** Hủy khi tầng cổng hết thời gian chờ. */
  signal: AbortSignal;
}

export interface AdapterReconcile {
  connectionId: string;
  externalId?: string | undefined;
  contentHash: string;
  from: Date;
  to: Date;
}

/** Tham số lượt gọi lại của nền tảng (đã tách khỏi query). */
export interface CallbackParams {
  code?: string | undefined;
  error?: string | undefined;
  /** 010: địa chỉ quay về đã dùng ở bước ủy quyền – Meta/TikTok yêu cầu khớp khi đổi `code`. */
  redirectUri?: string | undefined;
}

/** Page/tài khoản người dùng có thể chọn sau lượt gọi lại. Mã quyền chỉ đi tiếp vào vault. */
export interface ConnectionCandidate {
  externalId: string;
  displayName: string;
  /** Mã quyền thô của ứng viên – chỉ dùng để mã hóa ngay bằng CredentialVault. */
  accessToken: string;
  /** `null` khi nền tảng không có mốc hạn cố định (`expiry.kind = 'none'`). */
  tokenExpiresAt: Date | null;
  // ----- 010 (đều tùy chọn – bộ chuyển đổi cũ vẫn hợp lệ) -----
  avatarUrl?: string | undefined;
  /** `page`, `instagram_business`, `instagram_creator`, `tiktok_creator`… */
  accountType?: string | undefined;
  grantedScopes?: string[] | undefined;
  /** Instagram: mã Page nguồn (FR-042). */
  sourceExternalId?: string | undefined;
  /** Mã người dùng dài hạn (Meta) / refresh_token (TikTok) – cũng chỉ để mã hóa ngay. */
  refreshToken?: string | undefined;
  /** Hạn chính xác; thiếu → `{kind:'token', expiresAt: tokenExpiresAt}`. */
  expiry?: ExpiryInfo | undefined;
}

/** Kết quả thu hồi quyền phía nền tảng. KHÔNG ném: lỗi → `failed`; nền tảng không có API thu hồi → `unsupported`. */
export type RevokeResult = 'done' | 'failed' | 'unsupported';

export interface PlatformAdapter {
  readonly channelType: ChannelType;
  readonly capabilities: ChannelCapabilities;
  contentHash(text: string): string;
  checkAccount(cred: DecryptedCredential, ctx: AdapterCallContext): Promise<AccountCheckResult>;
  mediaRules(): MediaRules;
  submit(cred: DecryptedCredential, req: AdapterSubmit): Promise<SubmitResult>;
  checkStatus(
    cred: DecryptedCredential,
    processingId: string,
    ctx: AdapterCallContext,
  ): Promise<CheckStatusResult>;
  reconcile(cred: DecryptedCredential, q: AdapterReconcile): Promise<ReconcileResult>;
  classifyError(rawCode: string): ClassifiedError;
  refreshToken(cred: DecryptedCredential, ctx: AdapterCallContext): Promise<RefreshTokenResult>;
  /**
   * 010 T061: làm mới THẬT – nhận mã làm mới đã giải mã (Meta: mã người dùng dài hạn), trả mã mới để tầng kết nối ghi.
   * Chỉ có khi `capabilities.tokenRefresh`. `signal` ≤ 10 giây do bên gọi đặt.
   */
  renewToken?(
    refreshCred: DecryptedCredential,
    ctx: AdapterCallContext,
    signal?: AbortSignal,
  ): Promise<RenewTokenResult>;
  /** 010: thu hồi quyền phía nền tảng khi ngắt kết nối (FR-017). Không ném; thời gian chờ ≤ 5 giây do bên gọi đặt. */
  revoke(cred: DecryptedCredential, ctx: AdapterCallContext): Promise<RevokeResult>;
  /** 010: hạn hiện tại của quyền (đo lại bằng lời gọi nền tảng khi cần). Dạng `none` khi không có mốc hạn cố định. */
  expiryOf(cred: DecryptedCredential, ctx: AdapterCallContext): Promise<ExpiryInfo>;
  // Luồng kết nối (bản thật WBS 2.2 dùng OAuth):
  /** `rerequest`: xin lại đúng quyền bị từ chối (Meta `auth_type=rerequest`) khi kết nối lại. */
  authorizeUrl(state: string, redirectUri: string, opts?: { rerequest?: boolean }): string;
  exchangeCallback(params: CallbackParams): Promise<{ candidates: ConnectionCandidate[] }>;
}

/** Bảy thao tác ADR-05 + phụ trợ – bộ kiểm thử hợp đồng dùng để kiểm "đủ thao tác". */
export const ADAPTER_OPERATIONS = [
  'checkAccount',
  'mediaRules',
  'submit',
  'checkStatus',
  'reconcile',
  'classifyError',
  'refreshToken',
  'revoke',
  'expiryOf',
  'contentHash',
  'authorizeUrl',
  'exchangeCallback',
] as const;
