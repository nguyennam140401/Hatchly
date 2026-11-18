// Hợp đồng web ↔ API của module Cổng nền tảng (005 contracts/platform-gateway.md mục 3; 010 contracts/channels-http-api.md).
// Lối vào: `@app/shared/platform_gateway`. KHÔNG có trường mã quyền nào (nguyên tắc VII, FR-014).
import { z } from 'zod';

export const CHANNEL_TYPE_VALUES = [
  'facebook_page',
  'instagram',
  'tiktok',
  'zalo_oa',
  'test_channel',
] as const;
export const ChannelType = z.enum(CHANNEL_TYPE_VALUES);
export type ChannelType = z.infer<typeof ChannelType>;

/** Nền tảng người dùng kết nối được ở giai đoạn 1 (TikTok sau công tắc theo khách hàng). */
export const CONNECTABLE_CHANNEL_TYPES = ['facebook_page', 'instagram', 'tiktok'] as const;
export const ConnectableChannelType = z.enum(CONNECTABLE_CHANNEL_TYPES);
export type ConnectableChannelType = z.infer<typeof ConnectableChannelType>;

/** Giới hạn mặc định số kết nối mỗi nền tảng (`channel.max_per_platform`, FR-007). */
export const DEFAULT_MAX_CONNECTIONS_PER_PLATFORM = 5;

/** Số ứng viên tối đa một lần xác nhận (`ConfirmRequest.externalIds`). */
export const MAX_CONFIRM_CANDIDATES = 20;

/** POST /api/v1/channels/connect */
export const ConnectRequest = z.strictObject({
  channelType: ChannelType,
  /** Có → kết nối lại đúng kênh này (giữ nguyên `connectionId`, FR-008). */
  reconnectConnectionId: z.uuid().optional(),
});
export type ConnectRequest = z.infer<typeof ConnectRequest>;
export const ConnectResponse = z.object({ authorizeUrl: z.string() });
export type ConnectResponse = z.infer<typeof ConnectResponse>;

/** POST /api/v1/channels (giữ từ 005; ủy quyền cho `confirm`) */
export const SaveConnectionRequest = z.strictObject({
  selectionId: z.uuid(),
  externalId: z.string().min(1).max(200),
});
export type SaveConnectionRequest = z.infer<typeof SaveConnectionRequest>;

export const RemedyActionDto = z.enum([
  'reconnect',
  'retry_later',
  'edit_media',
  'edit_text',
  'check_on_platform',
  'contact_support',
]);
export type RemedyActionDto = z.infer<typeof RemedyActionDto>;

export const RemedyDto = z.object({ action: RemedyActionDto, labelVi: z.string() });
export type RemedyDto = z.infer<typeof RemedyDto>;

export const ClassifiedErrorDto = z.object({
  category: z.enum(['transient', 'user_action', 'unknown']),
  rawCode: z.string(),
  channelType: ChannelType,
  messageVi: z.string(),
  remedies: z.array(RemedyDto).min(1),
  retryAfterSec: z.number().optional(),
});

/** Hạn của quyền truy cập: `none` = nền tảng không có mốc hạn cố định (R2). */
export const ExpiryKind = z.enum(['none', 'token', 'data_access']);
export type ExpiryKind = z.infer<typeof ExpiryKind>;
export const ExpiryDto = z.object({
  kind: ExpiryKind,
  expiresAt: z.string().nullable(),
  daysLeft: z.number().int().nullable(),
});
export type ExpiryDto = z.infer<typeof ExpiryDto>;

export const AccountCheckDto = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('eligible'),
    accountType: z.string(),
    grantedScopes: z.array(z.string()),
    quotaRemaining: z.number().nullable(),
    /** `null` ⇔ `expiry.kind = 'none'`. */
    tokenExpiresAt: z.string().nullable(),
  }),
  z.object({ kind: z.literal('ineligible'), error: ClassifiedErrorDto }),
]);

// ----- Trạng thái kênh -----

/** Trạng thái hiển thị (FR-025). `status` công khai bên dưới luôn là 4 giá trị cũ để không phá 012/013 (R3). */
export const CHANNEL_STATE_VALUES = [
  'active',
  'expiring',
  'needs_reconnect',
  'ineligible',
  'suspended',
  'disconnected',
] as const;
export const ChannelState = z.enum(CHANNEL_STATE_VALUES);
export type ChannelState = z.infer<typeof ChannelState>;

/** Giữ đúng 4 giá trị (hợp đồng 012/013). */
export const ChannelConnectionStatus = z.enum(['active', 'expiring', 'expired', 'disconnected']);
export type ChannelConnectionStatus = z.infer<typeof ChannelConnectionStatus>;

/** Một kết nối kênh (không mã quyền). */
export const ChannelConnectionDto = z.object({
  connectionId: z.uuid(),
  channelType: ChannelType,
  displayName: z.string().max(120),
  externalId: z.string(),
  status: ChannelConnectionStatus,
  /** `null` ⇔ `expiry.kind = 'none'` (Meta không có mốc hạn cố định). */
  tokenExpiresAt: z.string().nullable(),
  connectedAt: z.string(),
  // Trường mới của 010 – tùy chọn để bộ chọn kênh của 012 giữ hình dạng cũ.
  state: ChannelState.optional(),
  reasonCode: z.string().nullable().optional(),
  expiry: ExpiryDto.optional(),
  sourceConnectionId: z.uuid().nullable().optional(),
});
export type ChannelConnectionDto = z.infer<typeof ChannelConnectionDto>;

// ----- Màn hình "Kênh kết nối" (GET /channels/overview) -----

export const OverviewActionKind = z.enum(['reconnect', 'recheck', 'disconnect', 'wait']);
export const OverviewAction = z.object({ kind: OverviewActionKind, labelVi: z.string() });

/** Trạng thái thẻ trên màn hình (không có `disconnected`: kênh đã ngắt không có thẻ). */
export const OverviewItemState = z.enum([
  'active',
  'expiring',
  'needs_reconnect',
  'ineligible',
  'suspended',
]);

export const ChannelOverviewItem = z.object({
  connectionId: z.uuid(),
  channelType: ChannelType,
  displayName: z.string().max(120),
  /** 6 ký tự từ `connectionId` để phân biệt các kênh trùng tên (FR-035). */
  shortCode: z.string().length(6),
  avatarUrl: z.string().nullable(),
  state: OverviewItemState,
  reasonCode: z.string().nullable(),
  reasonVi: z.string().nullable(),
  actionsVi: z.array(OverviewAction),
  expiry: ExpiryDto,
  conditions: z.object({
    accountType: z.string().nullable(),
    scopes: z.array(z.object({ nameVi: z.string(), granted: z.boolean() })),
    quotaRemaining: z.number().nullable(),
  }),
  sourceConnectionId: z.uuid().nullable(),
  sourceDisplayName: z.string().nullable(),
  scheduledImpact: z.object({ count: z.number().int(), nextAt: z.string().nullable() }),
  lastCheckedAt: z.string().nullable(),
  connectedAt: z.string(),
  supportDetails: z.object({ lastErrorCode: z.string().nullable() }),
});
export type ChannelOverviewItem = z.infer<typeof ChannelOverviewItem>;

export const OverviewAttention = z.object({
  connectionId: z.uuid(),
  kind: z.enum(['expiring', 'needs_reconnect', 'ineligible']),
  daysLeft: z.number().int().optional(),
});

export const OverviewPlatform = z.object({
  channelType: ConnectableChannelType,
  used: z.number().int(),
  limit: z.number().int(),
  canAdd: z.boolean(),
  experimental: z.boolean().optional(),
  note: z.string().optional(),
});

export const OverviewResponse = z.object({
  features: z.object({ tiktok: z.boolean() }),
  limits: z.object({ perPlatform: z.number().int() }),
  platforms: z.array(OverviewPlatform),
  connections: z.array(ChannelOverviewItem),
  attention: z.array(OverviewAttention),
  planActive: z.boolean(),
  viewerCanManage: z.boolean(),
});
export type OverviewResponse = z.infer<typeof OverviewResponse>;

// ----- Chọn Page/tài khoản sau khi cấp quyền -----

export const CANDIDATE_BLOCK_CODES = [
  'ALREADY_CONNECTED',
  'OWNED_BY_ANOTHER_ACCOUNT',
  'INELIGIBLE',
  'SCOPE_MISSING',
  'ROLE_TOO_LOW',
  'NOT_PROFESSIONAL',
  'PAGE_NOT_LINKED',
] as const;

/**
 * Hình dạng CŨ của 005 (`check` thay cho `selectable`/`blocked`). Chỉ còn controller 005 và e2e của nó dùng,
 * bỏ khi T026 viết lại điểm cuối theo `SelectionResponse` mới.
 */
export const LegacySelectionResponse = z.object({
  channelType: ChannelType,
  candidates: z.array(
    z.object({ externalId: z.string(), displayName: z.string(), check: AccountCheckDto }),
  ),
});
export type LegacySelectionResponse = z.infer<typeof LegacySelectionResponse>;

/** GET /api/v1/channels/selections/:selectionId */
export const SelectionResponse = z.object({
  channelType: ChannelType,
  remainingSlots: z.number().int(),
  limit: z.number().int(),
  candidates: z.array(
    z.object({
      externalId: z.string(),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
      accountType: z.string().nullable(),
      selectable: z.boolean(),
      blocked: z
        .object({
          code: z.enum(CANDIDATE_BLOCK_CODES),
          messageVi: z.string(),
          remedies: z.array(RemedyDto).min(1),
        })
        .nullable(),
    }),
  ),
});
export type SelectionResponse = z.infer<typeof SelectionResponse>;

/** POST /api/v1/channels/selections/:selectionId/confirm */
export const ConfirmRequest = z.strictObject({
  externalIds: z.array(z.string().min(1).max(200)).min(1).max(MAX_CONFIRM_CANDIDATES),
});
export type ConfirmRequest = z.infer<typeof ConfirmRequest>;

export const CONFIRM_OUTCOMES = [
  'created',
  'already_connected',
  'owned_by_another_account',
  'ineligible',
  'limit_reached',
  'not_in_selection',
] as const;

export const ConfirmResponse = z.object({
  results: z.array(
    z.object({
      externalId: z.string(),
      outcome: z.enum(CONFIRM_OUTCOMES),
      connection: ChannelOverviewItem.optional(),
      error: z.object({ messageVi: z.string(), remedies: z.array(RemedyDto).min(1) }).optional(),
    }),
  ),
});
export type ConfirmResponse = z.infer<typeof ConfirmResponse>;

// ----- Kiểm tra lại, ngắt kết nối -----

/** POST /api/v1/channels/:connectionId/recheck */
export const RecheckResponse = z.object({
  connection: ChannelOverviewItem,
  result: z.enum(['ok', 'changed', 'unavailable']),
  messageVi: z.string().optional(),
});
export type RecheckResponse = z.infer<typeof RecheckResponse>;

/** GET /api/v1/channels/:connectionId/disconnect-preview */
export const DisconnectPreview = z.object({
  connectionId: z.uuid(),
  displayName: z.string(),
  scheduledImpact: z.object({ count: z.number().int(), nextAt: z.string().nullable() }),
  dependents: z.array(
    z.object({
      connectionId: z.uuid(),
      displayName: z.string(),
      channelType: z.literal('instagram'),
    }),
  ),
});
export type DisconnectPreview = z.infer<typeof DisconnectPreview>;

/** DELETE /api/v1/channels/:connectionId */
export const DisconnectResponse = z.object({
  disconnected: z.literal(true),
  revoked: z.enum(['done', 'failed', 'skipped']),
  hintVi: z.string().optional(),
  cancelledAttempts: z.number().int(),
});
export type DisconnectResponse = z.infer<typeof DisconnectResponse>;

// ----- Mã lỗi -----

/** Mã lỗi của luồng gọi lại (query `error` khi chuyển về trang kết nối). */
export const CONNECT_ERROR_CODES = [
  'CONNECT_CANCELLED',
  'STATE_INVALID',
  'STATE_EXPIRED',
  'WRONG_CHANNEL',
  'FEATURE_NOT_ENABLED',
  'PROVIDER_UNAVAILABLE',
  'SCOPE_MISSING',
  'NO_CANDIDATES',
] as const;
export type ConnectErrorCode = (typeof CONNECT_ERROR_CODES)[number];

/** Mã lỗi nghiệp vụ của điểm cuối kênh (bảng mục 3 của contracts/channels-http-api.md). */
export const CHANNEL_ERROR_CODES = [
  'FEATURE_NOT_ENABLED',
  'PLAN_EXPIRED',
  'LIMIT_REACHED',
  'ALREADY_CONNECTED',
  'OWNED_BY_ANOTHER_ACCOUNT',
  'WRONG_CHANNEL',
  'STATE_INVALID',
  'STATE_EXPIRED',
  'SELECTION_NOT_FOUND',
  'CONNECTION_NOT_FOUND',
  'RECHECK_TOO_SOON',
  'PROVIDER_UNAVAILABLE',
  'CHANNEL_INELIGIBLE',
] as const;
export type ChannelErrorCode = (typeof CHANNEL_ERROR_CODES)[number];
