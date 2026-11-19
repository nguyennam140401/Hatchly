// Hiện thực `PublishingPublicApi` (012 contracts/module-api.md mục 2). Mọi thao tác ghi chạy TRONG giao
// dịch của người gọi (`approval`): duyệt + mục lịch đăng + việc là MỘT giao dịch (Hiến pháp II).
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray, min } from 'drizzle-orm';
import type { ChannelType, Remedy } from '@app/shared/content';
import { worstAttemptStatus } from '@app/shared/publishing';
import { tenantTx, type Db } from '../../../core';
import { CONTENT_PUBLIC_API, type ContentPublicApi } from '../../content';
import { PLATFORM_GATEWAY, type PlatformGatewayPublicApi } from '../../platform_gateway';
import { cancelJob, enqueue, rescheduleJob } from '../../queue';
import { runAttemptDedupeKey, runAttemptJob } from '../jobs';
import type {
  AttemptRef,
  CancelResult,
  PostPublishState,
  PrecheckResult,
  PublishingPublicApi,
  RescheduleResult,
  ScheduleInput,
  ScheduleResult,
} from '../public-api';
import {
  attemptsByPosts,
  cancelScheduled,
  effectiveAttempts,
  insertAttempt,
  lockChannelsForQuota,
  moveScheduled,
  wouldExceedQuota,
} from './attempts.repository';
import { publishAttempts } from './db/schema';
import { transitionMany } from './state-machine';

const RECONNECT: Remedy = { action: 'reconnect', labelVi: 'Kết nối lại' };
const REMOVE: Remedy = { action: 'remove_channel', labelVi: 'Bỏ kênh này khỏi bài' };

@Injectable()
export class PublishingService implements PublishingPublicApi {
  constructor(
    @Inject(CONTENT_PUBLIC_API) private readonly content: ContentPublicApi,
    @Inject(PLATFORM_GATEWAY) private readonly gateway: PlatformGatewayPublicApi,
  ) {}

  async schedule(tx: Db, input: ScheduleInput): Promise<ScheduleResult> {
    const channels = [...input.channels].sort((a, b) =>
      a.connectionId.localeCompare(b.connectionId),
    );
    await lockChannelsForQuota(
      tx,
      channels.map((c) => c.connectionId),
    );
    const rules = await this.content.channelRules();
    // Kiểm hạn mức cục bộ cho MỌI kênh trước khi chèn: một kênh vướng → cả bài không lên lịch.
    for (const c of channels) {
      const limit = rules.find((r) => r.channelType === c.channelType)?.maxPostsPer24h ?? null;
      if (
        limit !== null &&
        (await wouldExceedQuota(tx, c.connectionId, input.scheduledAt, limit, input.postId))
      ) {
        return { kind: 'quota_exceeded', connectionId: c.connectionId, limit };
      }
    }
    const refs: AttemptRef[] = [];
    let created = 0;
    for (const c of channels) {
      const attemptId = await insertAttempt(tx, {
        postId: input.postId,
        connectionId: c.connectionId,
        channelType: c.channelType,
        scheduledAt: input.scheduledAt,
        contentVersion: input.contentVersion,
        traceId: input.traceId,
      });
      if (attemptId === null) continue; // đã có mục hiệu lực – idempotent
      created++;
      await enqueue(
        runAttemptJob,
        { attemptId },
        {
          runAfter: input.scheduledAt,
          dedupeKey: runAttemptDedupeKey(attemptId),
        },
      );
      refs.push({ attemptId, connectionId: c.connectionId, channelType: c.channelType });
    }
    if (created === 0 && channels.length > 0) return { kind: 'already_scheduled' };
    return { kind: 'scheduled', attempts: refs };
  }

  async cancelByPost(tx: Db, postId: string): Promise<CancelResult> {
    const rows = await effectiveAttempts(tx, postId, true);
    const blocking = rows.filter((r) => r.status !== 'scheduled');
    if (blocking.length > 0) {
      return {
        kind: 'already_publishing',
        connectionIds: blocking.map((r) => r.channel_connection_id),
      };
    }
    const cancelled = await cancelScheduled(
      tx,
      rows.map((r) => r.id),
    );
    // Việc chưa chạy → hủy. Việc đã được Worker nhận nhưng mục vẫn `scheduled` thì bộ xử lý sẽ thấy mục
    // `cancelled` (cập nhật có điều kiện) và bỏ qua – không đăng nội dung cũ.
    for (const id of cancelled) {
      await cancelJob({ queue: 'publish', dedupeKey: runAttemptDedupeKey(id) });
    }
    return { kind: 'cancelled', count: cancelled.length };
  }

  async reschedule(tx: Db, postId: string, scheduledAt: Date): Promise<RescheduleResult> {
    const rows = await effectiveAttempts(tx, postId, true);
    const blocking = rows.filter((r) => r.status !== 'scheduled');
    if (blocking.length > 0) {
      return {
        kind: 'already_publishing',
        connectionIds: blocking.map((r) => r.channel_connection_id),
      };
    }
    await lockChannelsForQuota(
      tx,
      rows.map((r) => r.channel_connection_id),
    );
    const rules = await this.content.channelRules();
    for (const r of rows) {
      const limit = rules.find((x) => x.channelType === r.channel_type)?.maxPostsPer24h ?? null;
      if (
        limit !== null &&
        (await wouldExceedQuota(tx, r.channel_connection_id, scheduledAt, limit, postId))
      ) {
        return { kind: 'quota_exceeded', connectionId: r.channel_connection_id, limit };
      }
    }
    const moved = await moveScheduled(
      tx,
      rows.map((r) => r.id),
      scheduledAt,
    );
    for (const id of moved) {
      await rescheduleJob({ queue: 'publish', dedupeKey: runAttemptDedupeKey(id) }, scheduledAt);
    }
    return { kind: 'rescheduled', count: moved.length };
  }

  async cancelAllForConnection(tx: Db, connectionId: string): Promise<{ cancelled: number }> {
    const rows = await tx
      .select({ id: publishAttempts.id })
      .from(publishAttempts)
      .where(
        and(
          eq(publishAttempts.channel_connection_id, connectionId),
          inArray(publishAttempts.status, ['scheduled', 'retry_wait']),
        ),
      )
      .for('update');
    const cancelled = await transitionMany(
      tx,
      rows.map((r) => r.id),
      ['scheduled', 'retry_wait'],
      'cancelled',
      { phase: 'finished' },
    );
    for (const id of cancelled) {
      await cancelJob({ queue: 'publish', dedupeKey: runAttemptDedupeKey(id) });
    }
    return { cancelled: cancelled.length };
  }

  async countScheduledByConnections(
    connectionIds: readonly string[],
  ): Promise<Map<string, { count: number; nextAt: Date | null }>> {
    const out = new Map<string, { count: number; nextAt: Date | null }>(
      connectionIds.map((id) => [id, { count: 0, nextAt: null }]),
    );
    if (connectionIds.length === 0) return out;
    const rows = await tenantTx((db) =>
      db
        .select({
          id: publishAttempts.channel_connection_id,
          n: count(),
          next: min(publishAttempts.scheduled_at),
        })
        .from(publishAttempts)
        .where(
          and(
            inArray(publishAttempts.channel_connection_id, [...connectionIds]),
            inArray(publishAttempts.status, ['scheduled', 'retry_wait']),
          ),
        )
        .groupBy(publishAttempts.channel_connection_id),
    );
    for (const r of rows) out.set(r.id, { count: r.n, nextAt: r.next });
    return out;
  }

  async statusesByPosts(postIds: readonly string[]): Promise<Map<string, PostPublishState>> {
    const rows = await tenantTx((db) => attemptsByPosts(db, postIds));
    const out = new Map<string, PostPublishState>();
    for (const row of rows) {
      const state = out.get(row.post_id) ?? { worst: null, attempts: [], allScheduled: true };
      state.attempts.push({
        attemptId: row.id,
        connectionId: row.channel_connection_id,
        channelType: row.channel_type as ChannelType,
        status: row.status,
        scheduledAt: row.scheduled_at,
      });
      out.set(row.post_id, state);
    }
    for (const state of out.values()) {
      state.worst = worstAttemptStatus(state.attempts.map((a) => a.status));
      state.allScheduled = state.attempts.every((a) => a.status === 'scheduled');
    }
    return out;
  }

  async precheckChannels(connectionIds: readonly string[]): Promise<Map<string, PrecheckResult>> {
    const out = new Map<string, PrecheckResult>();
    for (const id of new Set(connectionIds)) {
      out.set(id, await this.precheckOne(id));
    }
    return out;
  }

  private async precheckOne(connectionId: string): Promise<PrecheckResult> {
    try {
      const connection = await this.gateway.getConnection(connectionId);
      if (connection === null || connection.status === 'disconnected') {
        return { ok: false, reason: 'inactive', remedies: [RECONNECT, REMOVE] };
      }
      if (connection.status === 'expired') {
        return { ok: false, reason: 'needs_reconnect', remedies: [RECONNECT, REMOVE] };
      }
      const check = await this.gateway.checkAccount(connectionId);
      if (check.kind === 'ineligible') {
        return { ok: false, reason: 'needs_reconnect', remedies: [RECONNECT, REMOVE] };
      }
      return { ok: true, quotaRemaining: check.quotaRemaining };
    } catch {
      // Nền tảng không trả lời: không chặn cứng ở bước kiểm trước (013 kiểm lại lúc đăng) nhưng báo rõ.
      return {
        ok: false,
        reason: 'unavailable',
        remedies: [{ action: 'choose_other_time', labelVi: 'Thử lại sau ít phút' }, REMOVE],
      };
    }
  }
}
