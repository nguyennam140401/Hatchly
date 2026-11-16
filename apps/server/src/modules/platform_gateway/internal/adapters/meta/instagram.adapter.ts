import type {
  AccountCheckResult,
  ChannelCapabilities,
  CheckStatusResult,
  ClassifiedError,
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
  ConnectionCandidate,
  PlatformAdapter,
} from '../adapter';
import { makeClassifier } from '../classify';
import { contentHashOf } from '../content-hash';
import { toClassified } from './facebook.adapter';
import { GraphClient, GraphError } from './graph-client';
import { INSTAGRAM_ERROR_TABLE } from './meta-errors';

// Bộ chuyển đổi Instagram (tài khoản chuyên nghiệp) – 013 US6. Quy trình HAI giai đoạn:
//   1. `submit`: tạo "container" media → trả `processing` + `processingId` (mã container);
//   2. `checkStatus`: hỏi `status_code`; khi `FINISHED` mới `media_publish` → `done` + đường dẫn bài.
// Instagram KHÔNG có bài chỉ chữ: bài phải có media (chặn ở bước 1 của luồng đăng và lại ở đây). Chi tiết điểm cuối là
// giả định cần kiểm chứng ở POC-2 / Meta App Review.

export interface InstagramAdapterOptions {
  client: GraphClient;
  reconcile: boolean;
}

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
      return {
        kind: 'eligible',
        accountType: 'professional',
        grantedScopes: [],
        quotaRemaining,
        tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000),
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

  authorizeUrl(): string {
    throw new Error('Luồng OAuth thuộc tính năng kết nối kênh (010).');
  }

  exchangeCallback(): Promise<{ candidates: ConnectionCandidate[] }> {
    return Promise.reject(new Error('Luồng OAuth thuộc tính năng kết nối kênh (010).'));
  }
}
