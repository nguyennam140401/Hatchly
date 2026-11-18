import type { ExpiryInfo } from '../../../public-api';
import type { GraphClient } from './graph-client';

// OAuth của Meta dùng chung cho Facebook Page và Instagram (010 R1, contracts/meta-tiktok-adapters.md mục 3).
// KHÔNG SDK ngoài: `fetch` có sẵn qua `GraphClient`. Quy tắc bảo mật (Hiến pháp VII): `code`, `client_secret`,
// `fb_exchange_token` đi trong THÂN form (POST), mã người dùng/Page chỉ trong tiêu đề `Authorization`; không bao giờ
// vào URL/nhật ký. Dữ kiện nền tảng đánh dấu [POC-2] cần kiểm khi nộp App Review.

export type MetaPlatform = 'facebook_page' | 'instagram';
export type ScopeGroup = 'publish' | 'analytics' | 'ads';

/** Quyền theo nhóm (R1a). `trends` không có quyền nền tảng nên không xuất hiện. [POC-2] */
const SCOPES: Record<MetaPlatform, Record<ScopeGroup, readonly string[]>> = {
  facebook_page: {
    publish: ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement'],
    analytics: ['read_insights'],
    ads: ['ads_read', 'ads_management', 'business_management'],
  },
  instagram: {
    publish: [
      'instagram_basic',
      'instagram_content_publish',
      'pages_show_list',
      'pages_read_engagement',
    ],
    analytics: ['instagram_manage_insights'],
    ads: ['ads_read', 'ads_management', 'business_management'],
  },
};

/** Quyền BẮT BUỘC để đăng bài – thiếu một trong số này ⇒ không đủ điều kiện (`SCOPE_MISSING`). */
export const REQUIRED_PUBLISH_SCOPES: Record<MetaPlatform, readonly string[]> = {
  facebook_page: ['pages_show_list', 'pages_manage_posts'],
  instagram: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
};

/**
 * Danh sách quyền xin theo nhóm đã bật; `override` (CHANNEL_SCOPES_*) thay thế hoàn toàn khi có.
 * Loại trùng, giữ thứ tự ổn định.
 */
export function resolveMetaScopes(
  platform: MetaPlatform,
  groups: readonly ScopeGroup[],
  override?: string,
): string[] {
  if (override !== undefined && override.trim() !== '') {
    return [
      ...new Set(
        override
          .split(',')
          .map((x) => x.trim())
          .filter((x) => x !== ''),
      ),
    ];
  }
  return [...new Set(groups.flatMap((g) => SCOPES[platform][g]))];
}

export interface MetaPage {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Mã Page – bí mật, chỉ để mã hóa ngay. */
  accessToken: string;
  tasks: string[];
  instagram: { id: string; username: string } | null;
}

export interface DebugTokenInfo {
  isValid: boolean;
  scopes: string[];
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
}

export interface MetaOAuthOptions {
  client: GraphClient;
  appId: string;
  /** Bí mật ứng dụng – chỉ ở thân form/tiêu đề, không bao giờ trong URL. */
  appSecret: string;
  /** Gốc hộp thoại cấp quyền, vd `https://www.facebook.com`. */
  dialogBaseUrl: string;
  version: string;
  scopes: Record<MetaPlatform, readonly string[]>;
}

/** Tối đa số Page lấy về (khớp CHECK `connect_selections.candidates ≤ 100`). */
export const MAX_PAGES = 100;

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asObject = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;

export class MetaOAuth {
  constructor(private readonly opts: MetaOAuthOptions) {}

  /** Địa chỉ ủy quyền: KHÔNG chứa `client_secret`; `state` đi nguyên văn; `rerequest` chỉ xin lại quyền bị từ chối. */
  authorizeUrl(
    platform: MetaPlatform,
    state: string,
    redirectUri: string,
    opts: { rerequest?: boolean } = {},
  ): string {
    const url = new URL(
      `${this.opts.dialogBaseUrl.replace(/\/+$/, '')}/${this.opts.version}/dialog/oauth`,
    );
    url.searchParams.set('client_id', this.opts.appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.opts.scopes[platform].join(','));
    if (opts.rerequest === true) url.searchParams.set('auth_type', 'rerequest');
    return url.toString();
  }

  /** `code` → mã ngắn hạn → mã người dùng DÀI HẠN. `expiresInSec = null` khi nền tảng không báo hạn. */
  async exchangeCode(
    code: string,
    redirectUri: string,
    signal?: AbortSignal,
  ): Promise<{ userToken: string; expiresInSec: number | null }> {
    const init = (form: Record<string, string>) => ({ form, ...(signal ? { signal } : {}) });
    const short = await this.opts.client.callWithToken<Record<string, unknown>>(
      '',
      'POST',
      'oauth/access_token',
      init({
        client_id: this.opts.appId,
        client_secret: this.opts.appSecret,
        redirect_uri: redirectUri,
        code,
      }),
    );
    const shortToken = asString(short.access_token);
    if (shortToken === undefined) throw new Error('META_NO_TOKEN');
    const long = await this.opts.client.callWithToken<Record<string, unknown>>(
      '',
      'POST',
      'oauth/access_token',
      init({
        grant_type: 'fb_exchange_token',
        client_id: this.opts.appId,
        client_secret: this.opts.appSecret,
        fb_exchange_token: shortToken,
      }),
    );
    const longToken = asString(long.access_token);
    if (longToken === undefined) throw new Error('META_NO_TOKEN');
    return {
      userToken: longToken,
      expiresInSec: typeof long.expires_in === 'number' ? long.expires_in : null,
    };
  }

  /** Mọi Page người dùng quản lý (có phân trang theo con trỏ, tối đa `MAX_PAGES`). */
  async listPages(userToken: string, signal?: AbortSignal): Promise<MetaPage[]> {
    const pages: MetaPage[] = [];
    let after: string | undefined;
    for (let guard = 0; guard < 20 && pages.length < MAX_PAGES; guard++) {
      const res = await this.opts.client.callWithToken<Record<string, unknown>>(
        userToken,
        'GET',
        'me/accounts',
        {
          query: {
            fields:
              'id,name,picture{url},access_token,tasks,instagram_business_account{id,username}',
            limit: '100',
            ...(after !== undefined ? { after } : {}),
          },
          ...(signal ? { signal } : {}),
        },
      );
      const data = Array.isArray(res.data) ? (res.data as unknown[]) : [];
      for (const raw of data) {
        const o = asObject(raw);
        const id = asString(o?.id);
        const accessToken = asString(o?.access_token);
        if (o === undefined || id === undefined || accessToken === undefined) continue;
        const ig = asObject(o.instagram_business_account);
        const igId = asString(ig?.id);
        pages.push({
          id,
          name: asString(o.name) ?? id,
          avatarUrl: asString(asObject(asObject(o.picture)?.data)?.url) ?? null,
          accessToken,
          tasks: Array.isArray(o.tasks)
            ? o.tasks.filter((t): t is string => typeof t === 'string')
            : [],
          instagram:
            igId === undefined ? null : { id: igId, username: asString(ig?.username) ?? igId },
        });
        if (pages.length >= MAX_PAGES) break;
      }
      const paging = asObject(res.paging);
      const next = asString(paging?.next);
      const cursor = asString(asObject(paging?.cursors)?.after);
      if (next === undefined || cursor === undefined) break;
      after = cursor;
    }
    return pages;
  }

  /**
   * `debug_token` bằng mã ỨNG DỤNG (`app_id|app_secret` ở tiêu đề). `input_token` là mã người dùng/Page nên đi trong
   * THÂN form (POST), không đặt ở query để không lọt vào URL/nhật ký. [POC-2] xác nhận Meta nhận POST cho điểm cuối này.
   */
  async debugToken(inputToken: string, signal?: AbortSignal): Promise<DebugTokenInfo> {
    const res = await this.opts.client.callWithToken<Record<string, unknown>>(
      `${this.opts.appId}|${this.opts.appSecret}`,
      'POST',
      'debug_token',
      { form: { input_token: inputToken }, ...(signal ? { signal } : {}) },
    );
    return parseDebug(res);
  }
}

function parseDebug(res: Record<string, unknown>): DebugTokenInfo {
  const d = asObject(res.data) ?? {};
  const toDate = (v: unknown): Date | null =>
    typeof v === 'number' && v > 0 ? new Date(v * 1000) : null;
  return {
    isValid: d.is_valid === true,
    scopes: Array.isArray(d.scopes)
      ? d.scopes.filter((s): s is string => typeof s === 'string')
      : [],
    expiresAt: toDate(d.expires_at),
    dataAccessExpiresAt: toDate(d.data_access_expires_at),
  };
}

/**
 * Hạn từ `debug_token` (R2): bỏ mốc `0`; không còn mốc ⇒ `none` ("không có ngày hết hạn cố định"); còn mốc ⇒ mốc SỚM
 * hơn của `expires_at` và `data_access_expires_at` kèm `kind` tương ứng.
 */
export function expiryFromDebug(d: DebugTokenInfo): ExpiryInfo {
  const candidates: ExpiryInfo[] = [];
  if (d.expiresAt !== null) candidates.push({ kind: 'token', expiresAt: d.expiresAt });
  if (d.dataAccessExpiresAt !== null) {
    candidates.push({ kind: 'data_access', expiresAt: d.dataAccessExpiresAt });
  }
  const timed = candidates.filter(
    (c): c is Extract<ExpiryInfo, { expiresAt: Date }> => c.kind !== 'none',
  );
  if (timed.length === 0) return { kind: 'none' };
  return timed.reduce((a, b) => (b.expiresAt.getTime() < a.expiresAt.getTime() ? b : a));
}
