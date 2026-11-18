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
import type { DecryptedCredential } from '../../vault/credential-vault';
import type {
  AdapterCallContext,
  AdapterReconcile,
  AdapterSubmit,
  CallbackParams,
  ConnectionCandidate,
  PlatformAdapter,
  RevokeResult,
} from '../adapter';
import { makeClassifier } from '../classify';
import { revealCredential } from '../../vault/credential-vault';
import { contentHashOf } from '../content-hash';
import { GraphClient, GraphError } from './graph-client';
import { FACEBOOK_ERROR_TABLE } from './meta-errors';
import { expiryFromDebug, REQUIRED_PUBLISH_SCOPES, type MetaOAuth } from './meta-oauth';

// Bộ chuyển đổi Facebook Page (013 US6, contracts/platform-adapters.md). Đồng bộ: `submit` trả `published` ngay.
// Chi tiết điểm cuối/trường là GIẢ ĐỊNH cần kiểm chứng ở POC-2 và khi nộp Meta App Review (docs/wiki/open-questions.md);
// luồng đăng chính chỉ thấy giao diện chung nên đổi chi tiết không đổi luồng. OAuth/refreshToken thuộc 010.

export interface FacebookAdapterOptions {
  client: GraphClient;
  /** Đối soát có dùng được không – mặc định `false` cho tới khi POC-2 xác nhận (hướng an toàn: "Cần kiểm tra"). */
  reconcile: boolean;
  /** Giới hạn dung lượng video (byte) – tham số cấu hình, mặc định 1 GB theo quyết định của PO (2026-11-16). */
  videoMaxBytes: number;
  /** 010: OAuth thật; `null` ⇒ chưa cấu hình ứng dụng Meta (kết nối trả "đang chuẩn bị"). */
  oauth?: MetaOAuth | null;
  /** 010: bật làm mới mã quyền bằng việc nền (`META_TOKEN_REFRESH_ENABLED`). */
  tokenRefresh?: boolean;
}

const classify = makeClassifier('facebook_page', FACEBOOK_ERROR_TABLE);

export function toClassified(
  err: GraphError,
  c: (code: string) => ClassifiedError,
): ClassifiedError {
  const base = c(err.rawCode);
  // Nền tảng báo thời gian chờ cụ thể (Retry-After) thì dùng, nhưng chỉ cho lỗi tạm thời.
  return base.category === 'transient' && err.retryAfterSec !== undefined
    ? { ...base, retryAfterSec: err.retryAfterSec }
    : base;
}

function asGraphError(e: unknown): GraphError {
  if (e instanceof GraphError) return e;
  // Lỗi không phải của Graph (lập trình/thiếu externalId…): không biết đã gửi chưa → coi như đã gửi (an toàn).
  return new GraphError({ rawCode: 'FB:ADAPTER_ERROR', httpStatus: null, sent: true });
}

export class FacebookAdapter implements PlatformAdapter {
  readonly channelType = 'facebook_page' as const;
  readonly capabilities: ChannelCapabilities;

  constructor(private readonly opts: FacebookAdapterOptions) {
    this.capabilities = {
      reconcile: opts.reconcile,
      asyncProcessing: false,
      tokenRefresh: opts.tokenRefresh ?? false,
      reportsQuota: false,
      maxReconcileWindowHours: 24,
    };
  }

  contentHash(text: string): string {
    return contentHashOf(text);
  }

  classifyError(rawCode: string): ClassifiedError {
    return classify(rawCode);
  }

  mediaRules(): MediaRules {
    return {
      maxItems: 10,
      image: { formats: ['jpeg', 'png'], maxBytes: 10_000_000, minAspect: 0.1, maxAspect: 10 },
      video: {
        formats: ['mp4', 'mov'],
        maxBytes: this.opts.videoMaxBytes,
        maxDurationSec: 14_400,
        minAspect: 0.1,
        maxAspect: 10,
      },
      allowMixed: false,
    };
  }

  private pageId(ctx: { externalId?: string | undefined }): string {
    if (ctx.externalId === undefined || ctx.externalId === '') throw new Error('Thiếu mã Page');
    return encodeURIComponent(ctx.externalId);
  }

  /**
   * Điều kiện tài khoản (010 FR-009): (a) mã còn hiệu lực + đủ quyền bắt buộc (`debug_token`), (b) vai trò đủ quyền
   * đăng (`tasks` chứa CREATE_CONTENT), (c) Page còn tồn tại, (d) Facebook không báo hạn mức nên `quotaRemaining = null`.
   * Chỉ kết luận KHẲNG ĐỊNH mới thành `ineligible`; lỗi mạng/5xx/mã lạ → `ineligible` kèm `category` transient/unknown
   * để bên gọi KHÔNG đổi trạng thái kênh (FR-012).
   */
  async checkAccount(
    cred: DecryptedCredential,
    ctx: AdapterCallContext,
  ): Promise<AccountCheckResult> {
    try {
      const page = await this.opts.client.call<{ id?: string; tasks?: unknown }>(
        cred,
        'GET',
        this.pageId(ctx),
        { query: { fields: 'id,name,tasks' } },
      );
      const oauth = this.opts.oauth ?? null;
      if (oauth === null) {
        // Chưa cấu hình ứng dụng Meta (013 chạy độc lập): chỉ xác nhận Page truy cập được.
        return {
          kind: 'eligible',
          accountType: 'page',
          grantedScopes: [],
          quotaRemaining: null,
          tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000),
        };
      }
      const info = await oauth.debugToken(revealCredential(cred));
      if (!info.isValid) return { kind: 'ineligible', error: classify('FB:190') };
      const missing = REQUIRED_PUBLISH_SCOPES.facebook_page.filter((x) => !info.scopes.includes(x));
      if (missing.length > 0) return { kind: 'ineligible', error: classify('FB:SCOPE_MISSING') };
      if (Array.isArray(page.tasks) && !page.tasks.includes('CREATE_CONTENT')) {
        return { kind: 'ineligible', error: classify('FB:ROLE_TOO_LOW') };
      }
      const expiry = expiryFromDebug(info);
      return {
        kind: 'eligible',
        accountType: 'page',
        grantedScopes: info.scopes,
        quotaRemaining: null,
        tokenExpiresAt:
          expiry.kind === 'none' ? new Date(Date.now() + 3650 * 86_400_000) : expiry.expiresAt,
        expiry,
      };
    } catch (e) {
      const err = asGraphError(e);
      // Page bị xóa/không còn quyền truy cập: Graph trả mã 100 (subcode 33) hoặc 803 cho nút không tồn tại.
      if (err.httpStatus === 400 && /^FB:(100:33|803)$/.test(err.rawCode)) {
        return { kind: 'ineligible', error: classify('FB:PAGE_UNAVAILABLE') };
      }
      return { kind: 'ineligible', error: toClassified(err, classify) };
    }
  }

  async submit(cred: DecryptedCredential, req: AdapterSubmit): Promise<SubmitResult> {
    try {
      const page = this.pageId(req);
      const signal = req.signal;
      const images = req.media.filter((m) => m.kind === 'image');
      const videos = req.media.filter((m) => m.kind === 'video');
      let postId: string;
      if (videos.length > 0) {
        const video = videos[0];
        if (video === undefined) throw new Error('video');
        const r = await this.opts.client.call<{ id: string }>(cred, 'POST', `${page}/videos`, {
          body: { file_url: video.url, description: req.text },
          signal,
        });
        postId = r.id;
      } else if (images.length === 1) {
        const image = images[0];
        if (image === undefined) throw new Error('image');
        const r = await this.opts.client.call<{ id: string; post_id?: string }>(
          cred,
          'POST',
          `${page}/photos`,
          { body: { url: image.url, caption: req.text }, signal },
        );
        postId = r.post_id ?? r.id;
      } else if (images.length > 1) {
        const ids: string[] = [];
        for (const image of images) {
          const r = await this.opts.client.call<{ id: string }>(cred, 'POST', `${page}/photos`, {
            body: { url: image.url, published: false },
            signal,
          });
          ids.push(r.id);
        }
        const r = await this.opts.client.call<{ id: string }>(cred, 'POST', `${page}/feed`, {
          body: { message: req.text, attached_media: ids.map((id) => ({ media_fbid: id })) },
          signal,
        });
        postId = r.id;
      } else {
        const r = await this.opts.client.call<{ id: string }>(cred, 'POST', `${page}/feed`, {
          body: { message: req.text },
          signal,
        });
        postId = r.id;
      }
      return {
        kind: 'published',
        platformPostId: postId,
        permalink: `https://www.facebook.com/${encodeURIComponent(postId)}`,
      };
    } catch (e) {
      return { kind: 'failed', error: toClassified(asGraphError(e), classify) };
    }
  }

  checkStatus(): Promise<CheckStatusResult> {
    // Facebook xử lý đồng bộ: không có trạng thái chờ. Gọi nhầm → "không xác định" (đối soát), không bịa kết quả.
    return Promise.resolve({ kind: 'failed', error: classify('FB:NO_ASYNC_PROCESSING') });
  }

  async reconcile(cred: DecryptedCredential, q: AdapterReconcile): Promise<ReconcileResult> {
    if (!this.capabilities.reconcile) return { kind: 'unsupported', reason: 'capability' };
    try {
      const r = await this.opts.client.call<{
        data?: { id: string; message?: string; created_time?: string; permalink_url?: string }[];
      }>(cred, 'GET', `${this.pageId(q)}/posts`, {
        query: {
          fields: 'id,message,created_time,permalink_url',
          since: String(Math.floor(q.from.getTime() / 1000)),
          until: String(Math.ceil(q.to.getTime() / 1000)),
          limit: '50',
        },
      });
      const found = (r.data ?? []).find(
        (p) => p.message !== undefined && contentHashOf(p.message) === q.contentHash,
      );
      return found === undefined
        ? { kind: 'not_found' }
        : {
            kind: 'found',
            platformPostId: found.id,
            permalink:
              found.permalink_url ?? `https://www.facebook.com/${encodeURIComponent(found.id)}`,
          };
    } catch {
      return { kind: 'unsupported', reason: 'platform_unavailable' };
    }
  }

  /**
   * Làm mới = đổi lại mã người dùng DÀI HẠN (`fb_exchange_token`) rồi lấy lại mã Page (chi tiết ở T061 – ghi mã mới do
   * tầng kết nối thực hiện). Hiện: không tự làm mới được ⇒ người dùng "Kết nối lại".
   */
  refreshToken(): Promise<RefreshTokenResult> {
    return Promise.resolve({
      kind: 'failed',
      error: {
        category: 'user_action',
        rawCode: 'FB:REFRESH_UNSUPPORTED',
        channelType: 'facebook_page',
        messageVi: 'Cần kết nối lại Trang để gia hạn quyền đăng bài.',
        remedies: [{ action: 'reconnect', labelVi: 'Kết nối lại Trang' }],
      },
    });
  }

  /**
   * Thu hồi quyền phía Facebook (FR-017): `DELETE /me/permissions` bằng mã NGƯỜI DÙNG (không phải mã Page). Không ném.
   * Bên gọi chỉ thu hồi khi đây là kết nối cuối cùng dùng chung mã người dùng đó.
   */
  async revoke(cred: DecryptedCredential): Promise<RevokeResult> {
    if (this.opts.oauth === null || this.opts.oauth === undefined) return 'unsupported';
    try {
      await this.opts.client.call(cred, 'DELETE', 'me/permissions');
      return 'done';
    } catch {
      return 'failed';
    }
  }

  /** Hạn đo lại bằng `debug_token` (bỏ mốc 0 ⇒ không có hạn cố định). Lỗi nền tảng ⇒ ném `GraphError` cho bên gọi xử lý. */
  async expiryOf(cred: DecryptedCredential): Promise<ExpiryInfo> {
    const oauth = this.opts.oauth ?? null;
    if (oauth === null) {
      return { kind: 'token', expiresAt: new Date(Date.now() + 60 * 86_400_000) };
    }
    return expiryFromDebug(await oauth.debugToken(revealCredential(cred)));
  }

  authorizeUrl(state: string, redirectUri: string, opts?: { rerequest?: boolean }): string {
    const oauth = this.opts.oauth ?? null;
    if (oauth === null) throw new Error('Chưa cấu hình ứng dụng Meta (FACEBOOK_APP_ID/SECRET).');
    return oauth.authorizeUrl('facebook_page', state, redirectUri, opts);
  }

  /**
   * `code` → mã người dùng dài hạn → danh sách Page. Mỗi Page là một ứng viên: `accessToken` = mã Page,
   * `refreshToken` = mã người dùng dài hạn (dùng làm mới/thu hồi). Điều kiện tài khoản kiểm sau bằng `checkAccount`.
   */
  async exchangeCallback(params: CallbackParams): Promise<{ candidates: ConnectionCandidate[] }> {
    const oauth = this.opts.oauth ?? null;
    if (oauth === null) throw new Error('Chưa cấu hình ứng dụng Meta (FACEBOOK_APP_ID/SECRET).');
    if (params.error !== undefined || params.code === undefined || params.code === '') {
      return { candidates: [] };
    }
    const redirectUri = params.redirectUri ?? '';
    const { userToken } = await oauth.exchangeCode(params.code, redirectUri);
    const [pages, info] = await Promise.all([
      oauth.listPages(userToken),
      oauth.debugToken(userToken),
    ]);
    const expiry = expiryFromDebug(info);
    return {
      candidates: pages.map((p) => ({
        externalId: p.id,
        displayName: p.name.slice(0, 120),
        accessToken: p.accessToken,
        refreshToken: userToken,
        tokenExpiresAt: expiry.kind === 'none' ? null : expiry.expiresAt,
        expiry,
        accountType: 'page',
        avatarUrl: p.avatarUrl ?? undefined,
        grantedScopes: info.scopes,
      })),
    };
  }
}
