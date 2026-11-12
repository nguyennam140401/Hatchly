// Hợp đồng web ↔ API của module Cổng nền tảng (005, contracts/platform-gateway.md mục 3 – kết nối kênh).
// Lối vào: `@app/shared/platform_gateway`. KHÔNG có trường mã quyền nào (nguyên tắc VII).
import { z } from 'zod';

export const CHANNEL_TYPE_VALUES = [
  'facebook_page',
  'instagram',
  'zalo_oa',
  'test_channel',
] as const;
export const ChannelType = z.enum(CHANNEL_TYPE_VALUES);
export type ChannelType = z.infer<typeof ChannelType>;

/** POST /api/v1/channels/connect */
export const ConnectRequest = z.strictObject({ channelType: ChannelType });
export type ConnectRequest = z.infer<typeof ConnectRequest>;
export const ConnectResponse = z.object({ authorizeUrl: z.string() });
export type ConnectResponse = z.infer<typeof ConnectResponse>;

/** POST /api/v1/channels */
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

export const ClassifiedErrorDto = z.object({
  category: z.enum(['transient', 'user_action', 'unknown']),
  rawCode: z.string(),
  channelType: ChannelType,
  messageVi: z.string(),
  remedies: z.array(z.object({ action: RemedyActionDto, labelVi: z.string() })).min(1),
  retryAfterSec: z.number().optional(),
});

export const AccountCheckDto = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('eligible'),
    accountType: z.string(),
    grantedScopes: z.array(z.string()),
    quotaRemaining: z.number().nullable(),
    tokenExpiresAt: z.string(),
  }),
  z.object({ kind: z.literal('ineligible'), error: ClassifiedErrorDto }),
]);

/** GET /api/v1/channels/selections/:selectionId */
export const SelectionResponse = z.object({
  channelType: ChannelType,
  candidates: z.array(
    z.object({ externalId: z.string(), displayName: z.string(), check: AccountCheckDto }),
  ),
});
export type SelectionResponse = z.infer<typeof SelectionResponse>;

export const ChannelConnectionStatus = z.enum(['active', 'expiring', 'expired', 'disconnected']);

/** Một kết nối kênh (không mã quyền). */
export const ChannelConnectionDto = z.object({
  connectionId: z.uuid(),
  channelType: ChannelType,
  displayName: z.string().max(120),
  externalId: z.string(),
  status: ChannelConnectionStatus,
  tokenExpiresAt: z.string(),
  connectedAt: z.string(),
});
export type ChannelConnectionDto = z.infer<typeof ChannelConnectionDto>;

/** Mã lỗi của luồng gọi lại (query `error` khi chuyển về trang kết nối). */
export const CONNECT_ERROR_CODES = ['CONNECT_CANCELLED', 'STATE_INVALID'] as const;
export type ConnectErrorCode = (typeof CONNECT_ERROR_CODES)[number];
