// Nhật ký 5 bước (FR-012, research R13): mỗi sự kiện một dòng (`started` | `finished`), CHỈ THÊM. Mỗi dòng ghi bằng
// một giao dịch RIÊNG ngắn đã commit (không nằm trong giao dịch gọi nền tảng), nên dù Worker chết giữa chừng vẫn
// còn dấu vết bước nào đã chạy. KHÔNG nhận mã quyền, nội dung bài hay phản hồi thô của nền tảng.
import { STEP_KEYS, type StepKey } from '@app/shared/publishing';
import { tenantTx, type Db } from '../../../core';
import { accountIdOrThrow } from './attempts.repository';
import { publishSteps } from './db/publish-steps.log-table';

export interface StepContext {
  attemptId: string;
  runNo: number;
  traceId: string;
}

export interface StepRemedy {
  action: string;
  labelVi: string;
}

export type StepOutcome = 'succeeded' | 'failed' | 'skipped' | 'not_applicable';

export interface FinishInfo {
  errorCategory?: 'transient' | 'user_action' | 'unknown';
  rawCode?: string;
  messageVi?: string;
  remedies?: readonly StepRemedy[];
  note?: string;
}

export function stepNo(key: StepKey): 1 | 2 | 3 | 4 | 5 {
  return (STEP_KEYS.indexOf(key) + 1) as 1 | 2 | 3 | 4 | 5;
}

/** Giữ `[A-Za-z0-9_.:-]`, cắt ≤ 64 ký tự; rỗng → `UNKNOWN`. */
export function sanitizeRawCode(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64);
  return cleaned === '' ? 'UNKNOWN' : cleaned;
}

const clip = (text: string | undefined, max: number): string | null =>
  text === undefined ? null : text.slice(0, max);

async function insertRow(
  db: Db,
  ctx: StepContext,
  key: StepKey,
  event: 'started' | 'finished',
  outcome: StepOutcome | null,
  info: FinishInfo,
): Promise<void> {
  await db.insert(publishSteps).values({
    account_id: accountIdOrThrow(),
    attempt_id: ctx.attemptId,
    run_no: ctx.runNo,
    step_no: stepNo(key),
    step_key: key,
    event,
    outcome,
    error_category: info.errorCategory ?? null,
    raw_code: sanitizeRawCode(info.rawCode),
    message_vi: clip(info.messageVi, 500),
    remedies: info.remedies === undefined ? null : [...info.remedies],
    note: clip(info.note, 200),
    trace_id: ctx.traceId,
  });
}

export function startStep(ctx: StepContext, key: StepKey): Promise<void> {
  return tenantTx((db) => insertRow(db, ctx, key, 'started', null, {}));
}

export function finishStep(
  ctx: StepContext,
  key: StepKey,
  outcome: StepOutcome,
  info: FinishInfo = {},
): Promise<void> {
  if (outcome === 'failed' && (info.remedies === undefined || info.remedies.length === 0)) {
    // Quy tắc VI: mỗi lỗi kèm ≥ 1 hành động khắc phục – chặn ngay ở nơi ghi.
    throw new Error('Bước lỗi phải kèm ít nhất một cách khắc phục');
  }
  return tenantTx((db) => insertRow(db, ctx, key, 'finished', outcome, info));
}

/** Ghi `finished/skipped` cho các bước sau bước lỗi để hỗ trợ thấy rõ "chưa chạy" (SC-005). */
export async function skipRemaining(
  ctx: StepContext,
  after: StepKey,
  note = 'Chưa chạy vì bước trước chưa xong',
): Promise<void> {
  const rest = STEP_KEYS.slice(STEP_KEYS.indexOf(after) + 1);
  if (rest.length === 0) return;
  await tenantTx(async (db) => {
    for (const key of rest) await insertRow(db, ctx, key, 'finished', 'skipped', { note });
  });
}
