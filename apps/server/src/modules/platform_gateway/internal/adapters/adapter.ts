import type {
  AccountCheckResult,
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
}

/** Page/tài khoản người dùng có thể chọn sau lượt gọi lại. Mã quyền chỉ đi tiếp vào vault. */
export interface ConnectionCandidate {
  externalId: string;
  displayName: string;
  /** Mã quyền thô của ứng viên – chỉ dùng để mã hóa ngay bằng CredentialVault. */
  accessToken: string;
  tokenExpiresAt: Date;
}

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
  // Luồng kết nối (bản thật WBS 2.2 dùng OAuth):
  authorizeUrl(state: string, redirectUri: string): string;
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
  'contentHash',
  'authorizeUrl',
  'exchangeCallback',
] as const;
