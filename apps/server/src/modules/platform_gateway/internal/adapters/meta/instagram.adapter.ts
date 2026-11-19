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
  AdapterReconcile,
  AdapterSubmit,
  CallbackParams,
  ConnectionCandidate,
  PlatformAdapter,
  RevokeResult,
} from '../adapter';
import { makeClassifier } from '../classify';
import { contentHashOf } from '../content-hash';
import { toClassified } from './facebook.adapter';
import { GraphClient, GraphError } from './graph-client';
import { INSTAGRAM_ERROR_TABLE } from './meta-errors';
import { expiryFromDebug, REQUIRED_PUBLISH_SCOPES, type MetaOAuth } from './meta-oauth';

// Bộ chuyển đổi Instagram (tài khoản chuyên nghiệp) – 013 US6. Quy trình HAI giai đoạn:
//   1. `submit`: tạo "container" media → trả `processing` + `processingId` (mã container);
//   2. `checkStatus`: hỏi `status_code`; khi `FINISHED` mới `media_publish` → `done` + đường dẫn bài.
// Instagram KHÔNG có bài chỉ chữ: bài phải có media (chặn ở bước 1 của luồng đăng và lại ở đây). Chi tiết điểm cuối là
// giả định cần kiểm chứng ở POC-2 / Meta App Review.

export interface InstagramAdapterOptions {
  client: GraphClient;
  reconcile: boolean;
  /** 010: luồng OAuth/đo hạn; `null`/thiếu ⇒ chưa cấu hình ứng dụng Meta (013 chạy độc lập). */
  oauth?: MetaOAuth | null;
}

/** Tiền tố `externalId` của ứng viên GIỮ CHỖ cho Page chưa liên kết Instagram (hiện "Page chưa liên kết", không kết nối được). */
export const UNLINKED_PREFIX = 'unlinked:';

const classify = makeClassifier('instagram', INSTAGRAM_ERROR_TABLE);

function asGraphError(e: unknown): GraphError {
  if (e instanceof GraphError) return e;
  return new GraphError({ rawCode: 'IG:ADAPTER_ERROR', httpStatus: null, sent: true });
}

export class InstagramAdapter implements PlatformAdapter {
  readonly channelType = 'instagram' as const;
  readonly capabilities: ChannelCapabilities;

  constructor(private readonly opts: InstagramAdapterOptions) {
    this.capabilities = {
      reconcile: opts.reconcile,
      asyncProcessing: true,
      tokenRefresh: false,
      reportsQuota: true,
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
      image: { formats: ['jpeg'], maxBytes: 8_000_000, minAspect: 0.8, maxAspect: 1.91 },
      video: {
        formats: ['mp4', 'mov'],
        maxBytes: 1_000_000_000,
        maxDurationSec: 900,
        minAspect: 0.01,
        maxAspect: 10,
      },
      allowMixed: false,
    };
  }

  private igId(ctx: { externalId?: string | undefined }): string {
    if (ctx.externalId === undefined || ctx.externalId === '')
      throw new Error('Thiếu mã tài khoản');
    return encodeURIComponent(ctx.externalId);
  }

  async checkAccount(
    cred: DecryptedCredential,
    ctx: AdapterCallContext,
  ): Promise<AccountCheckResult> {
    // Ứng viên giữ chỗ của Page chưa liên kết Instagram: kết luận khẳng định, KHÔNG gọi nền tảng.
    if (ctx.externalId?.startsWith(UNLINKED_PREFIX) === true) {
      return { kind: 'ineligible', error: classify('IG:PAGE_NOT_LINKED') };
    }
    try {
      const id = this.igId(ctx);
      const info = await this.opts.client.call<{ account_type?: string }>(cred, 'GET', id, {
        query: { fields: 'id,username,account_type' },
      });
      if (info.account_type?.toUpperCase() === 'PERSONAL') {
        return { kind: 'ineligible', error: classify('IG:NOT_PROFESSIONAL') };
      }
      let quotaRemaining: number | null = null;
      try {
        const q = await this.opts.client.call<{
          data?: { quota_usage?: number; config?: { quota_total?: number } }[];
        }>(cred, 'GET', `${id}/content_publishing_limit`, {
          query: { fields: 'quota_usage,config' },
        });
        const first = q.data?.[0];
        if (first?.quota_usage !== undefined && first.config?.quota_total !== undefined) {
          quotaRemaining = Math.max(0, first.config.quota_total - first.quota_usage);
        }
      } catch {
        // Không đọc được hạn mức: bỏ qua (null = không biết); hạn mức cục bộ của 012 vẫn là chốt chặn.
      }
      const oauth = this.opts.oauth ?? null;
      if (oauth === null) {
        return {
          kind: 'eligible',
          accountType: 'professional',
          grantedScopes: [],
          quotaRemaining,
          tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000),
        };
      }
      // Quyền bắt buộc + hạn (debug_token của mã Page nguồn).
      const debug = await oauth.debugToken(revealCredential(cred));
      if (!debug.isValid) return { kind: 'ineligible', error: classify('IG:190') };
      const missing = REQUIRED_PUBLISH_SCOPES.instagram.filter((x) => !debug.scopes.includes(x));
      if (missing.length > 0) return { kind: 'ineligible', error: classify('IG:SCOPE_MISSING') };
      const expiry = expiryFromDebug(debug);
      return {
        kind: 'eligible',
        accountType: 'professional',
        grantedScopes: debug.scopes,
        quotaRemaining,
        tokenExpiresAt:
          expiry.kind === 'none' ? new Date(Date.now() + 3650 * 86_400_000) : expiry.expiresAt,
        expiry,
      };
    } catch (e) {
      return { kind: 'ineligible', error: toClassified(asGraphError(e), classify) };
    }
  }

  async submit(cred: DecryptedCredential, req: AdapterSubmit): Promise<SubmitResult> {
    try {
      const id = this.igId(req);
      const signal = req.signal;
      if (req.media.length === 0) {
        // Phòng thủ: bước 1 đã chặn bài không media; không gọi nền tảng.
        return { kind: 'failed', error: classify('IG:NOT_PROFESSIONAL') };
      }
      if (req.media.length === 1) {
        const m = req.media[0];
        if (m === undefined) throw new Error('media');
        const body =
          m.kind === 'video'
            ? { media_type: 'REELS', video_url: m.url, caption: req.text }
            : { image_url: m.url, caption: req.text };
        const r = await this.opts.client.call<{ id: string }>(cred, 'POST', `${id}/media`, {
          body,
          signal,
        });
        return { kind: 'processing', processingId: r.id };
      }
      const children: string[] = [];
      for (const m of req.media) {
        const r = await this.opts.client.call<{ id: string }>(cred, 'POST', `${id}/media`, {
          body:
            m.kind === 'video'
              ? { media_type: 'VIDEO', video_url: m.url, is_carousel_item: true }
              : { image_url: m.url, is_carousel_item: true },
          signal,
        });
        children.push(r.id);
      }
      const r = await this.opts.client.call<{ id: string }>(cred, 'POST', `${id}/media`, {
        body: { media_type: 'CAROUSEL', children: children.join(','), caption: req.text },
        signal,
      });
      return { kind: 'processing', processingId: r.id };
    } catch (e) {
      return { kind: 'failed', error: toClassified(asGraphError(e), classify) };
    }
  }

  async checkStatus(
    cred: DecryptedCredential,
    processingId: string,
    ctx: AdapterCallContext,
  ): Promise<CheckStatusResult> {
    try {
      const container = encodeURIComponent(processingId);
      const s = await this.opts.client.call<{ status_code?: string }>(cred, 'GET', container, {
        query: { fields: 'status_code' },
      });
      const code = (s.status_code ?? '').toUpperCase();
      if (code === 'IN_PROGRESS' || code === '') return { kind: 'processing' };
      if (code === 'ERROR' || code === 'EXPIRED') {
        return { kind: 'failed', error: classify('IG:2207026') };
      }
      // FINISHED → xuất bản (một lần): `media_publish` là thao tác tạo bài.
      const published = await this.opts.client.call<{ id: string }>(
        cred,
        'POST',
        `${this.igId(ctx)}/media_publish`,
        { body: { creation_id: processingId } },
      );
      let permalink = `https://www.instagram.com/p/${encodeURIComponent(published.id)}/`;
      try {
        const info = await this.opts.client.call<{ permalink?: string }>(
          cred,
          'GET',
          encodeURIComponent(published.id),
          { query: { fields: 'permalink' } },
        );
        if (info.permalink !== undefined) permalink = info.permalink;
      } catch {
        // Bài đã đăng; thiếu đường dẫn đẹp thì dùng đường dẫn dựng từ mã.
      }
      return { kind: 'done', platformPostId: published.id, permalink };
    } catch (e) {
      return { kind: 'failed', error: toClassified(asGraphError(e), classify) };
    }
  }

  async reconcile(cred: DecryptedCredential, q: AdapterReconcile): Promise<ReconcileResult> {
    if (!this.capabilities.reconcile) return { kind: 'unsupported', reason: 'capability' };
    try {
      const r = await this.opts.client.call<{
        data?: { id: string; caption?: string; permalink?: string; timestamp?: string }[];
      }>(cred, 'GET', `${this.igId(q)}/media`, {
        query: { fields: 'id,caption,permalink,timestamp', limit: '50' },
      });
      const found = (r.data ?? []).find(
        (p) =>
          p.caption !== undefined &&
          contentHashOf(p.caption) === q.contentHash &&
          (p.timestamp === undefined || new Date(p.timestamp).getTime() >= q.from.getTime()),
      );
      return found === undefined
        ? { kind: 'not_found' }
        : {
            kind: 'found',
            platformPostId: found.id,
            permalink:
              found.permalink ?? `https://www.instagram.com/p/${encodeURIComponent(found.id)}/`,
          };
    } catch {
      return { kind: 'unsupported', reason: 'platform_unavailable' };
    }
  }

  refreshToken(): Promise<RefreshTokenResult> {
    return Promise.resolve({
      kind: 'failed',
      error: {
        category: 'user_action',
        rawCode: 'IG:REFRESH_UNSUPPORTED',
        channelType: 'instagram',
        messageVi: 'Cần kết nối lại tài khoản Instagram để gia hạn quyền đăng bài.',
        remedies: [{ action: 'reconnect', labelVi: 'Kết nối lại Instagram' }],
      },
    });
  }

  /** 010: thu hồi quyền – bộ chuyển đổi thật (T073) gọi API thu hồi; hiện chưa hỗ trợ. */
  revoke(): Promise<RevokeResult> {
    return Promise.resolve('unsupported');
  }

  /** Hạn đo lại bằng `debug_token` của mã Page nguồn (bỏ mốc 0 ⇒ không có hạn cố định). */
  async expiryOf(cred?: DecryptedCredential): Promise<ExpiryInfo> {
    const oauth = this.opts.oauth ?? null;
    if (oauth === null || cred === undefined) {
      return { kind: 'token', expiresAt: new Date(Date.now() + 60 * 86_400_000) };
    }
    return expiryFromDebug(await oauth.debugToken(revealCredential(cred)));
  }

  authorizeUrl(state: string, redirectUri: string, opts?: { rerequest?: boolean }): string {
    const oauth = this.opts.oauth ?? null;
    if (oauth === null) throw new Error('Chưa cấu hình ứng dụng Meta (FACEBOOK_APP_ID/SECRET).');
    return oauth.authorizeUrl('instagram', state, redirectUri, opts);
  }

  /**
   * Ứng viên = Page CÓ `instagram_business_account`: `externalId = ig_user_id`, `displayName = @username`,
   * `sourceExternalId` = mã Page; `accessToken` = mã Page (Instagram đăng bằng mã Page nguồn), `refreshToken` = mã
   * người dùng dài hạn. Page KHÔNG có Instagram ⇒ ứng viên GIỮ CHỖ `unlinked:<pageId>` (mã quyền rỗng) để màn hình
   * chọn hiện "Page chưa liên kết" kèm hướng dẫn (US2-3) – `checkAccount` kết luận `PAGE_NOT_LINKED`, không kết nối được.
   */
  async exchangeCallback(params: CallbackParams): Promise<{ candidates: ConnectionCandidate[] }> {
    const oauth = this.opts.oauth ?? null;
    if (oauth === null) throw new Error('Chưa cấu hình ứng dụng Meta (FACEBOOK_APP_ID/SECRET).');
    if (params.error !== undefined || params.code === undefined || params.code === '') {
      return { candidates: [] };
    }
    const { userToken } = await oauth.exchangeCode(params.code, params.redirectUri ?? '');
    const [pages, info] = await Promise.all([
      oauth.listPages(userToken),
      oauth.debugToken(userToken),
    ]);
    const expiry = expiryFromDebug(info);
    return {
      candidates: pages.map((p) =>
        p.instagram === null
          ? {
              externalId: `${UNLINKED_PREFIX}${p.id}`,
              displayName: p.name.slice(0, 120),
              accessToken: '',
              tokenExpiresAt: null,
              accountType: 'page_without_instagram',
              sourceExternalId: p.id,
              ...(p.avatarUrl === null ? {} : { avatarUrl: p.avatarUrl }),
            }
          : {
              externalId: p.instagram.id,
              displayName: `@${p.instagram.username}`.slice(0, 120),
              accessToken: p.accessToken,
              refreshToken: userToken,
              tokenExpiresAt: expiry.kind === 'none' ? null : expiry.expiresAt,
              expiry,
              accountType: 'professional',
              sourceExternalId: p.id,
              ...(p.avatarUrl === null ? {} : { avatarUrl: p.avatarUrl }),
              grantedScopes: info.scopes,
            },
      ),
    };
  }
}
