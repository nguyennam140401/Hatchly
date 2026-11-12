import { randomBytes } from 'node:crypto';
import type { ScenarioStore } from '../../../../dev/fake-components';
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
import type {
  AdapterCallContext,
  AdapterReconcile,
  AdapterSubmit,
  CallbackParams,
  ConnectionCandidate,
  PlatformAdapter,
} from '../adapters/adapter';
import { makeClassifier } from '../adapters/classify';
import { contentHashOf } from '../adapters/content-hash';
import { newFakeToken, revealCredential, type DecryptedCredential } from '../vault/credential-vault';
import { defaultFakePages, FAKE_CHANNELS, FAKE_ERROR_TABLE, type FakeChannelSpec } from './channels';
import type { FakePostStore } from './post-store';
import { FakeOauthPages, FakeStep } from './scenarios';

// Bộ chuyển đổi GIẢ của một loại kênh (005, contracts/platform-gateway.md mục 4) – đủ 7 thao tác + dấu
// nội dung + luồng kết nối giả. Hành vi điều khiển bằng kịch bản (ScenarioStore, component=platform,
// target `connection:{id}` hoặc `*`; Page giả: target `oauth`). KHÔNG chặn đăng trùng.

/** Tiền tố mã quyền giả của Page "không phải tài khoản chuyên nghiệp" – checkAccount trả ineligible. */
const NOT_PROFESSIONAL_PREFIX = 'fake_tok_np';
const DAY_MS = 86_400_000;

function rid(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

/** Chữ "nền tảng lưu" sau khi đổi nhẹ – đối soát phải vẫn khớp dấu. */
function alterText(text: string, how: 'shorten_links' | 'nfd' | 'whitespace'): string {
  switch (how) {
    case 'shorten_links':
      return text.replace(/https?:\/\/\S+/g, () => `https://fb.me/${randomBytes(3).toString('hex')}`);
    case 'nfd':
      return text.normalize('NFD');
    case 'whitespace':
      return `​ ${text.replace(/ /g, '   ')}\n`;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export class FakePlatformAdapter implements PlatformAdapter {
  readonly capabilities: ChannelCapabilities;
  private readonly spec: FakeChannelSpec;
  private readonly classify: (rawCode: string) => ClassifiedError;

  constructor(
    readonly channelType: ChannelType,
    private readonly posts: FakePostStore,
    private readonly scenarios: () => Promise<ScenarioStore>,
    spec?: FakeChannelSpec,
  ) {
    const resolved = spec ?? FAKE_CHANNELS[channelType];
    if (resolved === undefined) throw new Error(`Chưa khai báo kênh giả ${channelType}`);
    this.spec = resolved;
    this.capabilities = { ...resolved.capabilities };
    this.classify = makeClassifier(channelType, FAKE_ERROR_TABLE);
  }

  /** Lấy một bước kịch bản đúng loại (`key`) cho kết nối; không có → undefined. */
  private async step(connectionId: string | undefined, key: string): Promise<FakeStep | undefined> {
    const store = await this.scenarios();
    const target = connectionId === undefined ? '*' : `connection:${connectionId}`;
    const found = await store.take('platform', target, key);
    if (found === null) return undefined;
    const parsed = FakeStep.safeParse(found.spec);
    return parsed.success ? parsed.data : undefined;
  }

  private async latency(connectionId: string | undefined, signal?: AbortSignal): Promise<void> {
    const s = await this.step(connectionId, 'latencyMs');
    if (s !== undefined && 'latencyMs' in s) await sleep(s.latencyMs, signal);
  }

  contentHash(text: string): string {
    return contentHashOf(text);
  }

  mediaRules(): MediaRules {
    return structuredClone(this.spec.mediaRules);
  }

  classifyError(rawCode: string): ClassifiedError {
    return this.classify(rawCode);
  }

  async checkAccount(cred: DecryptedCredential, ctx: AdapterCallContext): Promise<AccountCheckResult> {
    await this.latency(ctx.connectionId);
    const s = await this.step(ctx.connectionId, 'check');
    const scripted = s !== undefined && 'check' in s ? s.check : undefined;
    const token = revealCredential(cred);
    const verdict =
      scripted ?? (token.startsWith(NOT_PROFESSIONAL_PREFIX) ? 'not_professional' : 'eligible');
    if (verdict === 'not_professional') {
      return { kind: 'ineligible', error: this.classify('FAKE_NOT_PROFESSIONAL') };
    }
    if (verdict === 'missing_permission') {
      return { kind: 'ineligible', error: this.classify('FAKE_PERMISSION_MISSING') };
    }
    return {
      kind: 'eligible',
      accountType: this.spec.accountType,
      grantedScopes: ['pages_manage_posts', 'pages_read_engagement'],
      quotaRemaining: this.capabilities.reportsQuota ? 200 : null,
      tokenExpiresAt: new Date(Date.now() + 60 * DAY_MS),
    };
  }

  async submit(_cred: DecryptedCredential, req: AdapterSubmit): Promise<SubmitResult> {
    await this.latency(req.connectionId, req.signal);
    const alter = await this.step(req.connectionId, 'alterStoredText');
    const storedText =
      alter !== undefined && 'alterStoredText' in alter
        ? alterText(req.text, alter.alterStoredText)
        : req.text;
    const s = await this.step(req.connectionId, 'submit');
    const mode = s !== undefined && 'submit' in s ? s.submit : 'published';
    const base = {
      connectionId: req.connectionId,
      contentHash: req.contentHash,
      storedTextHash: this.contentHash(storedText),
    };

    if (typeof mode === 'object') return { kind: 'failed', error: this.classify(mode.fail) };

    switch (mode) {
      case 'timeout_before_publish':
        // Nền tảng chưa nhận gì; treo tới khi tầng cổng hết thời gian chờ.
        await sleep(600_000, req.signal);
        return { kind: 'failed', error: this.classify('FAKE_TIMEOUT') };
      case 'timeout_after_publish': {
        // Bài ĐÃ lên nhưng phản hồi không bao giờ về.
        await this.insertPublished(base);
        await sleep(600_000, req.signal);
        return { kind: 'failed', error: this.classify('FAKE_TIMEOUT') };
      }
      case 'processing_then_done':
      case 'processing_then_failed': {
        if (!this.capabilities.asyncProcessing) {
          const post = await this.insertPublished(base);
          return { kind: 'published', platformPostId: post.platformPostId, permalink: post.permalink };
        }
        const processingId = rid('proc');
        await this.posts.insertPost({
          ...base,
          platformPostId: rid('post'),
          permalink: '',
          state: 'processing',
          processingId,
          processingOutcome: mode === 'processing_then_done' ? 'done_pending' : 'failed_pending',
          publishedAt: null,
        });
        return { kind: 'processing', processingId };
      }
      case 'published': {
        const post = await this.insertPublished(base);
        return { kind: 'published', platformPostId: post.platformPostId, permalink: post.permalink };
      }
    }
  }

  private insertPublished(base: { connectionId: string; contentHash: string; storedTextHash: string }) {
    const platformPostId = rid('post');
    return this.posts.insertPost({
      ...base,
      platformPostId,
      permalink: `https://fake.local/${this.channelType}/${platformPostId}`,
      state: 'published',
      processingId: null,
      processingOutcome: null,
      publishedAt: new Date(),
    });
  }

  async checkStatus(
    _cred: DecryptedCredential,
    processingId: string,
    ctx: AdapterCallContext,
  ): Promise<CheckStatusResult> {
    await this.latency(ctx.connectionId);
    const post = await this.posts.findByProcessingId(processingId);
    if (post === null || post.connectionId !== ctx.connectionId) {
      return { kind: 'failed', error: this.classify('FAKE_PROCESSING_NOT_FOUND') };
    }
    switch (post.processingOutcome) {
      case 'done_pending':
        await this.posts.updatePost(post.id, { processingOutcome: 'done_ready' });
        return { kind: 'processing' };
      case 'failed_pending':
        await this.posts.updatePost(post.id, { processingOutcome: 'failed_ready' });
        return { kind: 'processing' };
      case 'done_ready': {
        const permalink = `https://fake.local/${this.channelType}/${post.platformPostId}`;
        await this.posts.updatePost(post.id, {
          state: 'published',
          processingOutcome: 'done',
          publishedAt: new Date(),
        });
        return { kind: 'done', platformPostId: post.platformPostId, permalink };
      }
      case 'failed_ready':
        await this.posts.updatePost(post.id, { state: 'failed', processingOutcome: 'failed' });
        return { kind: 'failed', error: this.classify('FAKE_MEDIA_REJECTED') };
      default:
        return post.state === 'published'
          ? {
              kind: 'done',
              platformPostId: post.platformPostId,
              permalink: `https://fake.local/${this.channelType}/${post.platformPostId}`,
            }
          : { kind: 'failed', error: this.classify('FAKE_MEDIA_REJECTED') };
    }
  }

  async reconcile(_cred: DecryptedCredential, q: AdapterReconcile): Promise<ReconcileResult> {
    if (!this.capabilities.reconcile) return { kind: 'unsupported', reason: 'capability' };
    await this.latency(q.connectionId);
    const s = await this.step(q.connectionId, 'reconcile');
    if (s !== undefined && 'reconcile' in s) {
      return { kind: 'unsupported', reason: 'platform_unavailable' };
    }
    // Dấu đã được tính lại trên chữ nền tảng lưu (stored_text_hash) bằng chính contentHash().
    const post = await this.posts.findPublishedByStoredHash(q.connectionId, q.contentHash, q.from, q.to);
    if (post === null) return { kind: 'not_found' };
    return { kind: 'found', platformPostId: post.platformPostId, permalink: post.permalink };
  }

  async refreshToken(_cred: DecryptedCredential, ctx: AdapterCallContext): Promise<RefreshTokenResult> {
    await this.latency(ctx.connectionId);
    const s = await this.step(ctx.connectionId, 'refresh');
    const ok = s !== undefined && 'refresh' in s ? s.refresh === 'ok' : this.capabilities.tokenRefresh;
    if (!ok) return { kind: 'failed', error: this.classify('FAKE_TOKEN_EXPIRED') };
    return { kind: 'refreshed', tokenExpiresAt: new Date(Date.now() + 60 * DAY_MS) };
  }

  authorizeUrl(state: string, redirectUri: string): string {
    const q = new URLSearchParams({ state, redirect_uri: redirectUri });
    return `/api/v1/dev/fake-oauth/${this.channelType}/authorize?${q.toString()}`;
  }

  async exchangeCallback(params: CallbackParams): Promise<{ candidates: ConnectionCandidate[] }> {
    if (params.code === undefined || !params.code.startsWith('fake_code_')) {
      return { candidates: [] };
    }
    const store = await this.scenarios();
    const scripted = await store.take('platform', 'oauth', 'pages');
    const parsed = scripted === null ? undefined : FakeOauthPages.safeParse(scripted.spec);
    const pages =
      parsed?.success === true
        ? parsed.data.pages.map((p) => ({ ...p, eligible: p.eligible }))
        : defaultFakePages(this.channelType);
    const expires = new Date(Date.now() + 60 * DAY_MS);
    return {
      candidates: pages.map((p) => ({
        externalId: p.externalId,
        displayName: p.displayName,
        accessToken: p.eligible ? newFakeToken() : `${NOT_PROFESSIONAL_PREFIX}${newFakeToken().slice(9)}`,
        tokenExpiresAt: expires,
      })),
    };
  }
}
