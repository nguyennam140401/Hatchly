import type { ChannelOverviewItem } from '@app/shared/platform_gateway';
import { REQUIRED_PUBLISH_SCOPES } from '../adapters/meta/meta-oauth';
import { reasonInfo, type ChannelAction } from './connect-errors';
import { daysLeft, deriveState, type DerivedState } from './connection-state';
import type { StoredConnection } from './connection-store';
import { toStateInput } from '../gateway.service';

// Dựng thẻ kênh cho màn hình "Kênh kết nối" (010 contracts/channels-http-api.md mục 1.1). CHỈ dùng dữ liệu đã lưu,
// không gọi nền tảng (FR-028). KHÔNG có trường mã quyền nào – danh sách trường được liệt kê tường minh (Hiến pháp VII).

const RECONNECT: ChannelAction = { kind: 'reconnect', labelVi: 'Kết nối lại' };
const RECHECK: ChannelAction = { kind: 'recheck', labelVi: 'Kiểm tra lại' };
const DISCONNECT: ChannelAction = { kind: 'disconnect', labelVi: 'Ngắt kết nối' };

/** Hành động theo trạng thái (web-ui.md mục 3). Cộng tác viên không thấy nút – API vẫn chặn bằng `channel.manage`. */
function actionsFor(state: Exclude<DerivedState, 'disconnected'>): ChannelAction[] {
  switch (state) {
    case 'active':
      return [RECHECK, DISCONNECT];
    case 'expiring':
      return [RECONNECT, RECHECK, DISCONNECT];
    case 'needs_reconnect':
      return [RECONNECT, DISCONNECT];
    case 'ineligible':
      return [RECHECK, DISCONNECT];
    case 'suspended':
      return [DISCONNECT];
  }
}

/** Tên quyền đời thường (không hiện tên kỹ thuật của nền tảng cho người dùng). */
const SCOPE_NAME_VI: Readonly<Record<string, string>> = {
  pages_show_list: 'Xem danh sách Page của bạn',
  pages_manage_posts: 'Đăng và quản lý bài trên Page',
  pages_read_engagement: 'Xem tương tác trên Page',
  read_insights: 'Xem thống kê hiệu quả',
  instagram_basic: 'Xem thông tin tài khoản Instagram',
  instagram_content_publish: 'Đăng bài lên Instagram',
  instagram_manage_insights: 'Xem thống kê Instagram',
  ads_read: 'Xem quảng cáo',
  ads_management: 'Quản lý quảng cáo',
  business_management: 'Quản lý tài khoản doanh nghiệp',
  'user.info.basic': 'Xem thông tin tài khoản TikTok',
  'video.publish': 'Đăng video lên TikTok',
  'video.upload': 'Tải video lên TikTok',
};

/** 6 ký tự cuối của mã kết nối (UUID v7 có phần đầu theo thời gian nên các mã gần nhau trùng đầu). */
export function shortCodeOf(connectionId: string): string {
  return connectionId.replace(/-/g, '').slice(-6);
}

export interface OverviewContext {
  now: Date;
  warnDays: number;
  featureEnabled: boolean;
  /** Hàng Page nguồn của Instagram (`null` = không tìm thấy). */
  source?: StoredConnection | null | undefined;
  scheduledImpact?: { count: number; nextAt: Date | null } | undefined;
}

export function toOverviewItem(c: StoredConnection, ctx: OverviewContext): ChannelOverviewItem {
  const derived = deriveState(toStateInput(c), {
    now: ctx.now,
    warnDays: ctx.warnDays,
    featureEnabled: ctx.featureEnabled,
    source: ctx.source === undefined || ctx.source === null ? ctx.source : toStateInput(ctx.source),
  });
  // Kênh đã ngắt không có thẻ (giao diện vẽ nút "Kết nối …"); phòng thủ: coi như cần kết nối lại.
  const state: Exclude<DerivedState, 'disconnected'> =
    derived.state === 'disconnected' ? 'needs_reconnect' : derived.state;
  const info = reasonInfo(derived.reasonCode);
  const expiresAt = c.tokenExpiresAt;
  const noExpiry = c.tokenExpiresAt === null || c.expiryKind === 'none';
  const platform = c.channelType as string;
  const required =
    platform === 'facebook_page' || platform === 'instagram'
      ? REQUIRED_PUBLISH_SCOPES[platform]
      : [];
  const granted = new Set(c.grantedScopes ?? []);
  const scopeNames = [...new Set([...required, ...granted])];

  return {
    connectionId: c.id,
    channelType: c.channelType,
    displayName: c.displayName.slice(0, 120),
    shortCode: shortCodeOf(c.id),
    avatarUrl: c.avatarUrl ?? null,
    state,
    reasonCode: derived.reasonCode,
    reasonVi: info?.reasonVi ?? null,
    actionsVi: actionsFor(state),
    expiry:
      noExpiry || expiresAt === null
        ? { kind: 'none', expiresAt: null, daysLeft: null }
        : {
            kind: c.expiryKind === 'data_access' ? 'data_access' : 'token',
            expiresAt: expiresAt.toISOString(),
            daysLeft: daysLeft(expiresAt, ctx.now),
          },
    conditions: {
      accountType: c.accountType ?? null,
      scopes: scopeNames.map((name) => ({
        nameVi: SCOPE_NAME_VI[name] ?? name,
        granted: granted.has(name),
      })),
      quotaRemaining: c.quotaRemaining ?? null,
    },
    sourceConnectionId: c.sourceConnectionId ?? null,
    sourceDisplayName: ctx.source?.displayName.slice(0, 120) ?? null,
    scheduledImpact: {
      count: ctx.scheduledImpact?.count ?? 0,
      nextAt: ctx.scheduledImpact?.nextAt?.toISOString() ?? null,
    },
    lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
    connectedAt: c.connectedAt.toISOString(),
    supportDetails: { lastErrorCode: c.lastErrorCode ?? null },
  };
}
