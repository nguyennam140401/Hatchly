// Dựng phản hồi "Tiến trình đăng" của một bài (013 FR-007/012/025/027/028, contracts/publishing-http-api.md mục 1).
// Chỉ đọc. Người dùng thường KHÔNG BAO GIỜ thấy `retry_wait`/`unknown` (gộp thành "Đang đăng"); mã lỗi gốc, dấu nội
// dung, mã quyền, account_id KHÔNG có trong phản hồi (danh sách trường cho phép, không `select *`).
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, inArray, ne, eq } from 'drizzle-orm';
import {
  STEP_KEYS,
  remedyActionsForRole,
  toDisplayStatus,
  type AttemptAction,
  type ChannelProgressView,
  type PublishProgressView,
  type StepState,
  type StepView,
} from '@app/shared/publishing';
import type { AttemptStatus } from '@app/shared/content';
import { can, currentActor, tenantTx } from '../../../core';
import { PLATFORM_GATEWAY, type PlatformGatewayPublicApi } from '../../platform_gateway';
import { publishAttempts, type PublishAttemptRow } from './db/schema';
import { publishSteps, type PublishStepRow } from './db/publish-steps.log-table';

/** Hành động người dùng được phép theo trạng thái + lý do (hàm thuần, kiểm thử riêng). */
export function allowedActionsFor(
  status: AttemptStatus,
  needsReason: string | null,
  canAct: boolean,
  role: 'owner' | 'collaborator',
): AttemptAction[] {
  const actions: AttemptAction[] = [];
  if (status === 'needs_user') {
    if (needsReason === 'token_expired' || needsReason === 'not_professional_account') {
      actions.push('reconnect');
    }
    if (
      needsReason === 'overdue' ||
      needsReason === 'rate_limited_daily' ||
      needsReason === 'retries_exhausted'
    ) {
      actions.push('change_time');
    }
    if (needsReason === 'media_invalid') actions.push('edit_media');
    if (canAct) actions.push('republish');
    actions.push('contact_support');
  } else if (status === 'needs_check') {
    if (canAct) actions.push('mark_published', 'republish');
    actions.push('contact_support');
  }
  return remedyActionsForRole(actions, role);
}

const ORDER: Record<string, number> = Object.fromEntries(STEP_KEYS.map((k, i) => [k, i + 1]));

/**
 * Trạng thái từng bước của lần chạy hiện tại: gộp các dòng `started`/`finished` (dòng cuối của mỗi bước thắng).
 * Lỗi của lượt đang tự thử lại (`processing`/`retry_wait`/`unknown`) KHÔNG lộ ra: hiển thị "Đang thực hiện".
 */
export function buildSteps(
  rows: readonly PublishStepRow[],
  status: AttemptStatus,
): { steps: StepView[]; failedMessage: string | null; failedRemedies: StepView['remedies'] } {
  const hideFailures = status === 'processing' || status === 'retry_wait' || status === 'unknown';
  let failedMessage: string | null = null;
  let failedRemedies: StepView['remedies'] = [];
  const steps = STEP_KEYS.map((key, i): StepView => {
    const mine = rows.filter((r) => r.step_key === key);
    const last = mine.at(-1);
    const stepNo = (i + 1) as StepView['stepNo'];
    const empty = { at: null, note: null, messageVi: null, remedies: [] };
    if (status === 'scheduled' || last === undefined) {
      return { stepNo, key, state: 'not_run', ...empty };
    }
    const at = last.occurred_at.toISOString();
    if (last.event === 'started') {
      return { stepNo, key, state: 'running', at, note: null, messageVi: null, remedies: [] };
    }
    let state: StepState = last.outcome as StepState;
    // Bài đã đăng được (kể cả nhờ đối soát) thì lỗi "không xác định" trước đó không còn là lỗi.
    if (state === 'failed' && status === 'succeeded') state = 'succeeded';
    if (state === 'failed' && hideFailures) state = 'running';
    const showError = state === 'failed';
    const remedies = showError ? ((last.remedies as StepView['remedies'] | null) ?? []) : [];
    if (showError) {
      failedMessage = last.message_vi;
      failedRemedies = remedies;
    }
    return {
      stepNo,
      key,
      state,
      at,
      note: last.note,
      messageVi: showError ? last.message_vi : null,
      remedies,
    };
  });
  return { steps, failedMessage, failedRemedies };
}

@Injectable()
export class ProgressQuery {
  constructor(@Inject(PLATFORM_GATEWAY) private readonly gateway: PlatformGatewayPublicApi) {}

  async progress(postId: string): Promise<{ view: PublishProgressView; etag: string }> {
    const { attempts, steps } = await tenantTx(async (db) => {
      const attemptRows = await db
        .select()
        .from(publishAttempts)
        .where(and(eq(publishAttempts.post_id, postId), ne(publishAttempts.status, 'cancelled')))
        .orderBy(asc(publishAttempts.channel_connection_id));
      const ids = attemptRows.map((a) => a.id);
      const stepRows =
        ids.length === 0
          ? []
          : await db
              .select()
              .from(publishSteps)
              .where(inArray(publishSteps.attempt_id, ids))
              .orderBy(asc(publishSteps.occurred_at), asc(publishSteps.step_no));
      return { attempts: attemptRows, steps: stepRows };
    });

    const actor = currentActor();
    const role = actor?.kind === 'user' && actor.role === 'collaborator' ? 'collaborator' : 'owner';
    const canAct = can('post.republish');

    const channels: ChannelProgressView[] = [];
    for (const a of attempts) {
      channels.push(await this.channelView(a, steps, canAct, role));
    }
    const worst = worstDisplay(channels);
    const etag = createHash('sha1')
      .update(attempts.map((a) => `${a.id}:${a.version}:${a.updated_at.getTime()}`).join('|'))
      .update(canAct ? '1' : '0')
      .digest('hex');
    return { view: { postId, overall: worst, channels }, etag: `"${etag}"` };
  }

  private async channelView(
    a: PublishAttemptRow,
    allSteps: readonly PublishStepRow[],
    canAct: boolean,
    role: 'owner' | 'collaborator',
  ): Promise<ChannelProgressView> {
    const mine = allSteps.filter((s) => s.attempt_id === a.id && s.run_no === a.run_no);
    const built = buildSteps(mine, a.status);
    let displayName: string | null = null;
    try {
      displayName =
        (await this.gateway.getConnection(a.channel_connection_id))?.displayName ?? null;
    } catch {
      displayName = null;
    }
    const needs = a.status === 'needs_user' || a.status === 'needs_check';
    return {
      attemptId: a.id,
      channelType: a.channel_type,
      displayName,
      status: toDisplayStatus(a.status),
      needsKind: a.status === 'needs_user' || a.status === 'needs_check' ? a.status : null,
      scheduledAt: a.scheduled_at.toISOString(),
      permalink: a.status === 'succeeded' ? a.permalink : null,
      message: needs ? built.failedMessage : null,
      remedies: needs ? built.failedRemedies : [],
      allowedActions: allowedActionsFor(a.status, a.needs_reason, canAct, role),
      version: a.version,
      steps: built.steps,
    };
  }
}

const SEVERITY = {
  published: 0,
  cancelled: 0,
  scheduled: 1,
  publishing: 2,
  needs_action: 3,
} as const;

function worstDisplay(channels: readonly ChannelProgressView[]): PublishProgressView['overall'] {
  let worst: PublishProgressView['overall'] = null;
  for (const c of channels) {
    if (worst === null || SEVERITY[c.status] > SEVERITY[worst]) worst = c.status;
  }
  return worst;
}

export { ORDER as STEP_ORDER };
