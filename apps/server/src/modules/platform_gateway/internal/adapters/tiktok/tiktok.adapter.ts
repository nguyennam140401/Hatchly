import type {
  AccountCheckResult,
  ChannelCapabilities,
  CheckStatusResult,
  ClassifiedError,
  ExpiryInfo,
  MediaRules,
  ReconcileResult,
  RefreshTokenResult,
  SubmitResult,
} from '../../../public-api';
import { revealCredential, type DecryptedCredential } from '../../vault/credential-vault';
import type {
  AdapterCallContext,
  CallbackParams,
  ConnectionCandidate,
  PlatformAdapter,
  RenewTokenResult,
  RevokeResult,
} from '../adapter';
import { makeClassifier } from '../classify';
import { contentHashOf } from '../content-hash';
import { TiktokClient, TiktokError } from './tiktok-client';
import { TIKTOK_ERROR_TABLE } from './tiktok-errors';

// Bộ chuyển đổi TikTok (010 T079, contracts/meta-tiktok-adapters.md mục 4) – KẾT NỐI + kiểm tra + làm mới + thu hồi; ĐĂNG bài thật
// chưa hiện thực (R9): `submit`/`checkStatus` ⇒ `failed` `user_action` `TT:POSTING_NOT_AVAILABLE`, KHÔNG BAO GIỜ `transient`.
// Chỉ được dùng qua `FeatureGuardedAdapter` (công tắc `channel.tiktok` kiểm TRƯỚC khi chạm `TiktokClient`).
// Chi tiết điểm cuối/trường là GIẢ ĐỊNH cần kiểm chứng ở TikTok review (docs/wiki/open-questions.md).

export interface TiktokAdapterOptions {
  client: TiktokClient;
  clientKey: string;
  clientSecret: string;
  /** Địa chỉ trang ủy quyền (mặc định của TikTok). */
  authorizeBaseUrl?: string;
  scopes: readonly string[];
  /** Thời lượng video tối đa mặc định (giây) khi chưa biết từ `creator_info`. */
  maxVideoDurationSec?: number;
  now?: () => Date;
}

const classify = makeClassifier('tiktok', TIKTOK_ERROR_TABLE);
const REQUIRED_SCOPE = 'video.publish';

function asTiktokError(e: unknown): TiktokError {
  if (e instanceof TiktokError) return e;
  return new TiktokError({ rawCode: 'TT:ADAPTER_ERROR', httpStatus: null, sent: true });
}

/** Mã gốc → lỗi phân loại; lỗi mạng/5xx khi KIỂM TRA ⇒ `transient` an toàn (kiểm tra không có tác dụng phụ). */
function toClassified(err: TiktokError): ClassifiedError {
  const base = classify(err.rawCode);
  if (base.category !== 'unknown') return base;
  const netOrServer =
    err.rawCode.startsWith('TT:NET_') ||
    err.rawCode === 'TT:TIMEOUT_AFTER_SEND' ||
    (err.httpStatus !== null && err.httpStatus >= 500);
  return netOrServer ? { ...base, category: 'transient' } : base;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  refresh_expires_in?: unknown;
  open_id?: unknown;
  scope?: unknown;
}

export class TiktokAdapter implements PlatformAdapter {
  readonly channelType = 'tiktok' as const;
  readonly capabilities: ChannelCapabilities = {
    reconcile: false,
    asyncProcessing: true,
    tokenRefresh: true,
    reportsQuota: false,
    maxReconcileWindowHours: null,
  };

  constructor(private readonly opts: TiktokAdapterOptions) {}

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  contentHash(text: string): string {
    return contentHashOf(text);
  }

  classifyError(rawCode: string): ClassifiedError {
    return classify(rawCode);
  }

  /** Chỉ video (`image = null`); thời lượng tối đa theo cấu hình (từ `creator_info` khi biết). */
  mediaRules(): MediaRules {
    return {
      maxItems: 1,
      image: null,
      video: {
        formats: ['mp4', 'mov'],
        maxBytes: 4_000_000_000,
        maxDurationSec: this.opts.maxVideoDurationSec ?? 600,
        minAspect: 0.1,
        maxAspect: 10,
      },
      allowMixed: false,
    };
  }

  authorizeUrl(state: string, redirectUri: string): string {
    const url = new URL(this.opts.authorizeBaseUrl ?? 'https://www.tiktok.com/v2/auth/authorize/');
    url.searchParams.set('client_key', this.opts.clientKey);
    url.searchParams.set('scope', this.opts.scopes.join(','));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    return url.toString();
  }

  /** `code` → cặp mã (access + refresh) → thông tin người dùng; MỘT ứng viên (`open_id`). */
  async exchangeCallback(params: CallbackParams): Promise<{ candidates: ConnectionCandidate[] }> {
    if (params.error !== undefined || params.code === undefined || params.code === '') {
      return { candidates: [] };
    }
    const tokens = await this.opts.client.request<TokenResponse>('POST', 'v2/oauth/token/', {
      form: {
        client_key: this.opts.clientKey,
        client_secret: this.opts.clientSecret,
        code: params.code,
        grant_type: 'authorization_code',
        redirect_uri: params.redirectUri ?? '',
      },
    });
    const access = typeof tokens.access_token === 'string' ? tokens.access_token : undefined;
    const refresh = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : undefined;
    const openId = typeof tokens.open_id === 'string' ? tokens.open_id : undefined;
    if (access === undefined || openId === undefined) {
      throw new TiktokError({ rawCode: 'TT:NO_TOKEN', httpStatus: null, sent: true });
    }
    const info = await this.opts.client
      .request<{ data?: { user?: { display_name?: unknown; avatar_url?: unknown } } }>(
        'GET',
        'v2/user/info/',
        { token: access, query: { fields: 'open_id,display_name,avatar_url' } },
      )
      .catch(() => undefined);
    const user = info?.data?.user;
    const expiry = this.refreshExpiry(tokens);
    return {
      candidates: [
        {
          externalId: openId,
          displayName:
            typeof user?.display_name === 'string' && user.display_name !== ''
              ? user.display_name.slice(0, 120)
              : 'Tài khoản TikTok',
          accessToken: access,
          ...(refresh !== undefined ? { refreshToken: refresh } : {}),
          tokenExpiresAt: expiry.kind === 'none' ? null : expiry.expiresAt,
          expiry,
          accountType: 'creator',
          ...(typeof user?.avatar_url === 'string' ? { avatarUrl: user.avatar_url } : {}),
          grantedScopes:
            typeof tokens.scope === 'string' ? tokens.scope.split(',').filter((s) => s !== '') : [],
        },
      ],
    };
  }

  /** Hạn của `refresh_token` (mốc quyết định "cần kết nối lại"); không báo ⇒ `none` – không bịa ngày. */
  private refreshExpiry(t: TokenResponse): ExpiryInfo {
    return typeof t.refresh_expires_in === 'number' && t.refresh_expires_in > 0
      ? { kind: 'token', expiresAt: new Date(this.now().getTime() + t.refresh_expires_in * 1000) }
      : { kind: 'none' };
  }

  /**
   * Điều kiện đăng video: `creator_info/query` thành công ⇒ đã có quyền đăng. Thiếu quyền (`scope_not_authorized`) ⇒ `SCOPE_MISSING`;
   * lỗi mạng/5xx/mã lạ ⇒ `ineligible` KHÔNG phải `user_action` để bên gọi giữ nguyên trạng thái kênh (FR-012).
   */
  async checkAccount(cred: DecryptedCredential): Promise<AccountCheckResult> {
    try {
      await this.opts.client.request('POST', 'v2/post/publish/creator_info/query/', {
        token: revealCredential(cred),
        body: {},
      });
      return {
        kind: 'eligible',
        quotaRemaining: null,
        grantedScopes: [REQUIRED_SCOPE],
        accountType: 'creator',
        tokenExpiresAt: new Date(this.now().getTime() + 24 * 3_600_000),
      };
    } catch (e) {
      const err = asTiktokError(e);
      const code = err.rawCode === 'TT:scope_not_authorized' ? 'TT:SCOPE_MISSING' : err.rawCode;
      return { kind: 'ineligible', error: toClassified(new TiktokError({ rawCode: code, httpStatus: err.httpStatus, sent: err.sent })) };
    }
  }

  /** TikTok không có điểm đo hạn: hạn `refresh_token` được ghi lúc kết nối/làm mới ⇒ không bịa, để bên gọi giữ hạn đã lưu. */
  expiryOf(): Promise<ExpiryInfo> {
    return Promise.reject(
      new TiktokError({ rawCode: 'TT:EXPIRY_UNKNOWN', httpStatus: null, sent: false }),
    );
  }

  /** Giữ tương thích giao diện công khai: làm mới thật đi qua `renewToken` (cần mã làm mới). */
  refreshToken(): Promise<RefreshTokenResult> {
    return Promise.resolve({ kind: 'failed', error: classify('TT:REFRESH_UNSUPPORTED') });
  }

  /** Làm mới: `refresh_token` → CẶP mã mới (cả hai đều được tầng kết nối ghi). */
  async renewToken(
    refreshCred: DecryptedCredential,
    _ctx: AdapterCallContext,
    signal?: AbortSignal,
  ): Promise<RenewTokenResult> {
    try {
      const t = await this.opts.client.request<TokenResponse>('POST', 'v2/oauth/token/', {
        form: {
          client_key: this.opts.clientKey,
          client_secret: this.opts.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: revealCredential(refreshCred),
        },
        ...(signal ? { signal } : {}),
      });
      if (typeof t.access_token !== 'string') {
        return { kind: 'failed', error: classify('TT:NO_TOKEN') };
      }
      return {
        kind: 'renewed',
        accessToken: t.access_token,
        ...(typeof t.refresh_token === 'string' ? { refreshToken: t.refresh_token } : {}),
        expiry: this.refreshExpiry(t),
      };
    } catch (e) {
      return { kind: 'failed', error: toClassified(asTiktokError(e)) };
    }
  }

  /** Thu hồi quyền phía TikTok. Không ném. */
  async revoke(cred: DecryptedCredential): Promise<RevokeResult> {
    try {
      await this.opts.client.request('POST', 'v2/oauth/revoke/', {
        form: {
          client_key: this.opts.clientKey,
          client_secret: this.opts.clientSecret,
          token: revealCredential(cred),
        },
      });
      return 'done';
    } catch {
      return 'failed';
    }
  }

  /** Đăng thật chưa hiện thực: `user_action`, KHÔNG BAO GIỜ `transient` (không để bộ chạy tự thử lại vô ích). */
  submit(): Promise<SubmitResult> {
    return Promise.resolve({ kind: 'failed', error: classify('TT:POSTING_NOT_AVAILABLE') });
  }

  checkStatus(): Promise<CheckStatusResult> {
    return Promise.resolve({ kind: 'failed', error: classify('TT:POSTING_NOT_AVAILABLE') });
  }

  reconcile(): Promise<ReconcileResult> {
    return Promise.resolve({ kind: 'unsupported', reason: 'capability' });
  }
}
