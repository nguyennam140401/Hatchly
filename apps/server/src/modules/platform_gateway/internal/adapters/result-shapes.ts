import { z } from 'zod';
import { gatewayEvent } from '../../../../core/gateways/op-log';
import {
  CHANNEL_TYPES,
  type ChannelType,
  type CheckStatusResult,
  type ClassifiedError,
  type ReconcileResult,
  type SubmitResult,
} from '../../public-api';
import { UNKNOWN_MESSAGE_VI } from './classify';

// Khuôn Zod cho mọi kết quả của bộ chuyển đổi (005, quy tắc bất biến 3, research R15). Kết quả ngoài
// khuôn (kể cả `kind` lạ) KHÔNG được tin: `submit`/`checkStatus` → `failed/unknown`, `reconcile` →
// `unsupported/platform_unavailable`, kèm nhật ký `platform.unexpected_result` (không in giá trị).

const remedy = z.object({
  action: z.enum([
    'reconnect',
    'retry_later',
    'edit_media',
    'edit_text',
    'check_on_platform',
    'contact_support',
  ]),
  labelVi: z.string().min(1),
});

export const ClassifiedErrorShape = z.object({
  category: z.enum(['transient', 'user_action', 'unknown']),
  rawCode: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/),
  channelType: z.enum(CHANNEL_TYPES),
  messageVi: z.string().min(1),
  remedies: z.array(remedy).min(1),
  retryAfterSec: z.number().int().positive().optional(),
});

const text = z.string().min(1).max(500);

export const SubmitResultShape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('published'), platformPostId: text, permalink: text }),
  z.object({ kind: z.literal('processing'), processingId: text }),
  z.object({ kind: z.literal('failed'), error: ClassifiedErrorShape }),
]);

export const CheckStatusResultShape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('processing') }),
  z.object({ kind: z.literal('done'), platformPostId: text, permalink: text }),
  z.object({ kind: z.literal('failed'), error: ClassifiedErrorShape }),
]);

export const ReconcileResultShape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('found'), platformPostId: text, permalink: text }),
  z.object({ kind: z.literal('not_found') }),
  z.object({
    kind: z.literal('unsupported'),
    reason: z.enum(['capability', 'window_too_large', 'platform_unavailable']),
  }),
]);

export const AccountCheckShape = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('eligible'),
    accountType: z.string(),
    grantedScopes: z.array(z.string()),
    quotaRemaining: z.number().nullable(),
    tokenExpiresAt: z.date(),
  }),
  z.object({ kind: z.literal('ineligible'), error: ClassifiedErrorShape }),
]);

export const RefreshTokenShape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('refreshed'), tokenExpiresAt: z.date() }),
  z.object({ kind: z.literal('failed'), error: ClassifiedErrorShape }),
]);

/** `unknown` dùng khi kết quả lạ / hết thời gian chờ (không bao giờ `transient`). */
export function unknownError(channelType: ChannelType, rawCode: string): ClassifiedError {
  return {
    category: 'unknown',
    rawCode,
    channelType,
    messageVi: UNKNOWN_MESSAGE_VI,
    remedies: [{ action: 'check_on_platform', labelVi: 'Kiểm tra trên trang' }],
  };
}

type Op = 'submit' | 'checkStatus' | 'reconcile';
type ResultOf<O extends Op> = O extends 'submit'
  ? SubmitResult
  : O extends 'checkStatus'
    ? CheckStatusResult
    : ReconcileResult;

const SHAPES = {
  submit: SubmitResultShape,
  checkStatus: CheckStatusResultShape,
  reconcile: ReconcileResultShape,
} as const;

/** Kết quả hợp lệ → trả lại; ngoài khuôn → kết quả an toàn + `platform.unexpected_result`. */
export function assertResultShape<O extends Op>(
  op: O,
  channelType: ChannelType,
  value: unknown,
): ResultOf<O> {
  const parsed = SHAPES[op].safeParse(value);
  if (parsed.success) return value as ResultOf<O>;
  gatewayEvent('warn', 'platform.unexpected_result', { kind: op, channel_type: channelType });
  if (op === 'reconcile') {
    return { kind: 'unsupported', reason: 'platform_unavailable' } as ResultOf<O>;
  }
  return {
    kind: 'failed',
    error: unknownError(channelType, 'UNEXPECTED_RESULT'),
  } as ResultOf<O>;
}
