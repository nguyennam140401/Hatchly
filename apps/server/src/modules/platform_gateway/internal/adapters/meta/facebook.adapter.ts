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
  ConnectionCandidate,
  PlatformAdapter,
  RevokeResult,
} from '../adapter';
import { makeClassifier } from '../classify';
import { contentHashOf } from '../content-hash';
import { GraphClient, GraphError } from './graph-client';
import { FACEBOOK_ERROR_TABLE } from './meta-errors';

// Bộ chuyển đổi Facebook Page (013 US6, contracts/platform-adapters.md). Đồng bộ: `submit` trả `published` ngay.
// Chi tiết điểm cuối/trường là GIẢ ĐỊNH cần kiểm chứng ở POC-2 và khi nộp Meta App Review (docs/wiki/open-questions.md);
// luồng đăng chính chỉ thấy giao diện chung nên đổi chi tiết không đổi luồng. OAuth/refreshToken thuộc 010.

export interface FacebookAdapterOptions {
  client: GraphClient;
  /** Đối soát có dùng được không – mặc định `false` cho tới khi POC-2 xác nhận (hướng an toàn: "Cần kiểm tra"). */
  reconcile: boolean;
  /** Giới hạn dung lượng video (byte) – tham số cấu hình, mặc định 1 GB theo quyết định của PO (2026-11-16). */
  videoMaxBytes: number;
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
      tokenRefresh: false,
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

  async checkAccount(
    cred: DecryptedCredential,
    ctx: AdapterCallContext,
  ): Promise<AccountCheckResult> {
    try {
      await this.opts.client.call(cred, 'GET', this.pageId(ctx), { query: { fields: 'id,name' } });
      return {
        kind: 'eligible',
        accountType: 'page',
        grantedScopes: [],
        quotaRemaining: null,
        // Hạn mã quyền do kết nối (010) quản lý; Cổng dùng `tokenExpiresAt` của kết nối khi tính trạng thái.
        tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000),
      };
    } catch (e) {
      return { kind: 'ineligible', error: toClassified(asGraphError(e), classify) };
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

  /** 010: thu hồi quyền – bộ chuyển đổi thật (T073) gọi API thu hồi; hiện chưa hỗ trợ. */
  revoke(): Promise<RevokeResult> {
    return Promise.resolve('unsupported');
  }

  /** 010: hạn – dùng mốc tạm cho tới khi T039/T044 đo bằng `debug_token`. */
  expiryOf(): Promise<ExpiryInfo> {
    return Promise.resolve({ kind: 'token', expiresAt: new Date(Date.now() + 60 * 86_400_000) });
  }

  authorizeUrl(): string {
    throw new Error('Luồng OAuth thuộc tính năng kết nối kênh (010).');
  }

  exchangeCallback(): Promise<{ candidates: ConnectionCandidate[] }> {
    return Promise.reject(new Error('Luồng OAuth thuộc tính năng kết nối kênh (010).'));
  }
}
