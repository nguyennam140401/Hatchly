// Điều phối duyệt & lịch (012 contracts/module-api.md mục 3). Mỗi thao tác đổi trạng thái hoặc đụng lịch
// chạy trong MỘT `tenantTx`: đổi trạng thái bài + mục lịch đăng + việc nền + sự kiện + thông báo + kiểm toán
// cùng sinh hoặc cùng hoàn tác (Hiến pháp II). Không gọi nền tảng bên ngoài khi đang giữ giao dịch:
// `precheckChannels` chạy TRƯỚC `tenantTx`.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@app/shared/core';
import type {
  BulkResult,
  BulkResultItem,
  ChannelIssue,
  PendingItem,
  PendingListResponse,
} from '@app/shared/approval';
import { postTitle } from '@app/shared/content';
import {
  APP_CONFIG,
  AppError,
  can,
  requireCustomer,
  tenantTx,
  uuidV7,
  type AppConfig,
  type Db,
} from '../../../core';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../../account';
import {
  CONTENT_PUBLIC_API,
  type ContentPublicApi,
  type PostRecord,
  type SaveFields,
  type TransitionResult,
} from '../../content';
import { NOTIFICATIONS, type NotificationsPublicApi } from '../../notifications';
import {
  PUBLISHING_PUBLIC_API,
  type PrecheckResult,
  type PublishingPublicApi,
} from '../../publishing';
import type { ApprovalPublicApi, ApproveItemInput } from '../public-api';
import {
  bulkLimitExceeded,
  channelIssuesError,
  contentInvalidError,
  missingScheduleTime,
  onlySubmitterCanWithdraw,
  planExpired,
  timeAndContentTogether,
  timeInPast,
} from './approval-errors';
import { writePostAudit } from './audit';
import { suggestTimes } from './suggest-times';
import { postAlreadyDone, postNotEditable, postNotFound, postVersionConflict } from './post-errors';

const MINUTE = 60_000;

/** Cổng kiểm tra gói còn hạn (FR-015) – TÙY CHỌN tới khi module Tài khoản & Gói có mô hình gói. */
export interface PlanGate {
  assertActive(): Promise<void>;
}
export const PLAN_GATE = Symbol('PLAN_GATE');

interface Actor {
  userId: string;
  isOwner: boolean;
}

@Injectable()
export class ApprovalService implements ApprovalPublicApi {
  private readonly logger = new Logger('approval');

  constructor(
    @Inject(CONTENT_PUBLIC_API) private readonly content: ContentPublicApi,
    @Inject(PUBLISHING_PUBLIC_API) private readonly publishing: PublishingPublicApi,
    @Inject(NOTIFICATIONS) private readonly notifications: NotificationsPublicApi,
    @Inject(ACCOUNT_PUBLIC_API) private readonly members: Pick<AccountPublicApi, 'describeMembers'>,
    @Inject(APP_CONFIG)
    private readonly config: Pick<
      AppConfig,
      | 'POST_MIN_LEAD_MINUTES'
      | 'POST_SUGGEST_HOURS'
      | 'POST_BULK_APPROVE_LIMIT'
      | 'POST_BULK_SUBMIT_LIMIT'
    >,
    @Inject(PLAN_GATE) private readonly plan: PlanGate | null,
  ) {}

  // ----- tiện ích ----------------------------------------------------------------------------

  private actor(): Actor {
    const a = requireCustomer();
    return { userId: a.userId, isOwner: can('post.approve') };
  }

  private async assertPlan(): Promise<void> {
    if (this.plan === null) return;
    try {
      await this.plan.assertActive();
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw planExpired();
    }
  }

  /** Giờ gợi ý đầu tiên (kèm trong lỗi `TIME_IN_PAST`). */
  private async firstSuggestion(): Promise<Date | null> {
    return (await this.suggestTimes(1))[0] ?? null;
  }

  private async assertLead(at: Date): Promise<void> {
    const min = Date.now() + this.config.POST_MIN_LEAD_MINUTES * MINUTE;
    if (at.getTime() < min) {
      throw timeInPast(await this.firstSuggestion(), this.config.POST_MIN_LEAD_MINUTES);
    }
  }

  /** Lệch phiên bản: đã ở trạng thái đích → "đã xử lý" (idempotent), ngược lại → xung đột kèm bản mới. */
  private async staleError(
    current: PostRecord,
    doneStatuses: PostRecord['status'][],
  ): Promise<AppError> {
    const view = await this.content.presentPost(current);
    return doneStatuses.includes(current.status)
      ? postAlreadyDone(view)
      : postVersionConflict(view);
  }

  private async resultError(
    result: TransitionResult,
    done: PostRecord['status'][],
  ): Promise<AppError> {
    if (result.kind === 'not_found') return postNotFound();
    if (result.kind === 'ok') throw new Error('resultError gọi với kết quả ok');
    return this.staleError(result.current, done);
  }

  private title(post: PostRecord): string {
    return postTitle(post.internalName, post.sharedText);
  }

  /** Kiểm tra trước (NGOÀI giao dịch): kênh ngắt / hết quyền / hết hạn mức nền tảng báo. */
  private async precheck(
    post: PostRecord,
    cache?: Map<string, PrecheckResult>,
  ): Promise<ChannelIssue[]> {
    const ids = post.variants.map((v) => v.connectionId);
    const fresh = ids.filter((id) => cache?.has(id) !== true);
    if (fresh.length > 0) {
      const got = await this.publishing.precheckChannels(fresh);
      for (const [id, res] of got) cache?.set(id, res);
      cache ??= got;
    }
    const issues: ChannelIssue[] = [];
    for (const id of ids) {
      const res = cache?.get(id);
      if (res === undefined) continue;
      if (!res.ok && res.reason !== 'unavailable') {
        issues.push({
          connectionId: id,
          code: 'CHANNEL_INACTIVE',
          messageVi: 'Kênh này đã ngắt hoặc hết hạn quyền nên chưa lên lịch được.',
          remedies: res.remedies,
        });
      } else if (res.ok && res.quotaRemaining !== null && res.quotaRemaining <= 0) {
        issues.push({
          connectionId: id,
          code: 'CHANNEL_QUOTA_EXCEEDED',
          messageVi: 'Nền tảng báo kênh này đã hết lượt đăng hôm nay.',
          remedies: [
            { action: 'choose_other_time', labelVi: 'Chọn giờ khác' },
            { action: 'remove_channel', labelVi: 'Bỏ kênh này khỏi bài' },
          ],
        });
      }
    }
    return issues;
  }

  // ----- duyệt -------------------------------------------------------------------------------

  async approve(postId: string, expectedVersion: number, scheduledAt: Date): Promise<PostRecord> {
    return this.approveOne(this.actor(), postId, expectedVersion, scheduledAt);
  }

  private async approveOne(
    actor: Actor,
    postId: string,
    expectedVersion: number,
    scheduledAt: Date,
    cache?: Map<string, PrecheckResult>,
  ): Promise<PostRecord> {
    await this.assertPlan();
    await this.assertLead(scheduledAt);
    // (1) TRƯỚC giao dịch: đọc bài + kiểm tra kênh (có thể gọi nền tảng).
    const peek = await this.content.getPost(postId);
    if (peek === null) throw postNotFound();
    const early = await this.precheck(peek, cache);
    if (early.length > 0) {
      const quota = early.every((i) => i.code === 'CHANNEL_QUOTA_EXCEEDED');
      throw channelIssuesError(quota ? 'CHANNEL_QUOTA_EXCEEDED' : 'CHANNEL_INACTIVE', early);
    }

    // (2) TRONG một giao dịch: tất cả hoặc không.
    return tenantTx(async (tx) => {
      const post = await this.content.loadForUpdate(tx, postId);
      if (post === null) throw postNotFound();
      if (post.version !== expectedVersion || !['draft', 'pending_review'].includes(post.status)) {
        throw await this.staleError(post, ['approved']);
      }
      const valid = await this.content.validateForScheduling(tx, post, scheduledAt);
      if (!valid.ok) throw contentInvalidError(valid.channelIssues, valid.contentIssues);

      const now = new Date();
      const moved = await this.content.transition(tx, {
        postId,
        expectedVersion,
        from: ['draft', 'pending_review'],
        to: 'approved',
        set: {
          scheduledAt,
          approvedBy: actor.userId,
          approvedAt: now,
          editedAfterApproval: false,
          returnedNote: null,
          returnedBy: null,
          returnedAt: null,
        },
        event: {
          type: 'approved',
          actorUserId: actor.userId,
          data: {
            fromVersion: expectedVersion,
            toVersion: expectedVersion + 1,
            toAt: scheduledAt.toISOString(),
          },
        },
      });
      if (moved.kind !== 'ok') throw await this.resultError(moved, ['approved']);

      const scheduled = await this.publishing.schedule(tx, {
        postId,
        contentVersion: moved.post.version,
        scheduledAt,
        channels: moved.post.variants.map((v) => ({
          connectionId: v.connectionId,
          channelType: v.channelType,
        })),
      });
      if (scheduled.kind === 'quota_exceeded') {
        throw channelIssuesError('CHANNEL_QUOTA_EXCEEDED', [
          {
            connectionId: scheduled.connectionId,
            code: 'CHANNEL_QUOTA_EXCEEDED',
            messageVi: `Kênh này chỉ đăng tối đa ${scheduled.limit} bài trong 24 giờ và đã đủ ở khung giờ này.`,
            remedies: [
              { action: 'choose_other_time', labelVi: 'Chọn giờ khác' },
              { action: 'remove_channel', labelVi: 'Bỏ kênh này khỏi bài' },
            ],
          },
        ]);
      }
      await writePostAudit(tx, actor.userId, 'post.approve', {
        postId,
        fromVersion: expectedVersion,
        toVersion: moved.post.version,
      });
      return moved.post;
    });
  }

  async approveBatch(items: ApproveItemInput[]): Promise<BulkResult> {
    if (items.length > this.config.POST_BULK_APPROVE_LIMIT) {
      throw bulkLimitExceeded(this.config.POST_BULK_APPROVE_LIMIT);
    }
    const actor = this.actor();
    // Kiểm tra trước MỘT lần cho cả lô: mỗi kênh gọi một lần dù nhiều bài dùng chung.
    const posts = await this.content.getPosts(items.map((i) => i.postId));
    const cache = new Map<string, PrecheckResult>();
    const ids = [...new Set(posts.flatMap((p) => p.variants.map((v) => v.connectionId)))];
    for (const [id, res] of await this.publishing.precheckChannels(ids)) cache.set(id, res);
    const byId = new Map(posts.map((p) => [p.id, p]));
    return this.runBulk(
      items.map((i) => i.postId),
      async (postId, index) => {
        const item = items[index];
        if (item === undefined) throw new Error('Chỉ số bài ngoài phạm vi');
        const at = item.scheduledAt ?? byId.get(postId)?.scheduledAt ?? null;
        if (at === null) throw missingScheduleTime();
        await this.approveOne(actor, postId, item.expectedVersion, at, cache);
      },
    );
  }

  /** Mỗi bài một giao dịch độc lập: một bài lỗi KHÔNG ảnh hưởng bài khác. */
  private async runBulk(
    postIds: string[],
    fn: (postId: string, index: number) => Promise<void>,
  ): Promise<BulkResult> {
    const results: BulkResultItem[] = [];
    for (const [index, postId] of postIds.entries()) {
      try {
        await fn(postId, index);
        results.push({ postId, status: 'ok' });
      } catch (err) {
        if (err instanceof AppError) {
          results.push({
            postId,
            status: 'failed',
            error: {
              code: err.code,
              message: err.message,
              ...(err.extra !== undefined ? { extra: err.extra } : {}),
            },
          });
        } else {
          this.logger.error({ msg: 'approval.bulk.item_failed', err, postId });
          results.push({
            postId,
            status: 'failed',
            error: {
              code: ERROR_CODES.INTERNAL_ERROR,
              message: 'Đã có lỗi xảy ra với bài này. Hãy thử lại.',
            },
          });
        }
      }
    }
    const succeeded = results.filter((r) => r.status === 'ok').length;
    return { succeeded, failed: results.length - succeeded, results };
  }

  // ----- gửi duyệt, rút lại ------------------------------------------------------------------

  async submit(input: { items: ApproveItemInput[] }): Promise<BulkResult> {
    if (input.items.length > this.config.POST_BULK_SUBMIT_LIMIT) {
      throw bulkLimitExceeded(this.config.POST_BULK_SUBMIT_LIMIT);
    }
    const actor = this.actor();
    const submissionId = uuidV7();
    const okTitles: string[] = [];
    const okIds: string[] = [];
    const result = await this.runBulk(
      input.items.map((i) => i.postId),
      async (postId, index) => {
        const item = input.items[index];
        if (item === undefined) throw new Error('Chỉ số bài ngoài phạm vi');
        const post = await tenantTx(async (tx) => {
          const cur = await this.content.loadForUpdate(tx, postId);
          if (cur === null) throw postNotFound();
          if (cur.version !== item.expectedVersion || cur.status !== 'draft') {
            throw await this.staleError(cur, ['pending_review']);
          }
          const valid = await this.content.validateForScheduling(tx, cur, new Date());
          if (!valid.ok) throw contentInvalidError(valid.channelIssues, valid.contentIssues);
          const moved = await this.content.transition(tx, {
            postId,
            expectedVersion: item.expectedVersion,
            from: ['draft'],
            to: 'pending_review',
            set: {
              submittedBy: actor.userId,
              submittedAt: new Date(),
              submissionId,
              ...(item.scheduledAt !== undefined ? { scheduledAt: item.scheduledAt } : {}),
              // Gửi lại bài bị trả: xóa nhãn "Bị trả lại"; ghi chú cũ vẫn nằm trong lịch sử.
              returnedNote: null,
              returnedBy: null,
              returnedAt: null,
            },
            event: {
              type: 'submitted',
              actorUserId: actor.userId,
              data: {
                fromVersion: item.expectedVersion,
                toVersion: item.expectedVersion + 1,
                submissionId,
              },
            },
          });
          if (moved.kind !== 'ok') throw await this.resultError(moved, ['pending_review']);
          await writePostAudit(tx, actor.userId, 'post.submit', {
            postId,
            fromVersion: item.expectedVersion,
            toVersion: moved.post.version,
            submissionId,
          });
          return moved.post;
        });
        okIds.push(post.id);
        okTitles.push(this.title(post));
      },
    );
    if (okIds.length > 0) {
      // MỘT thông báo + MỘT email cho cả lần gửi (khóa chống trùng dựng từ `submissionId`).
      await tenantTx((tx) =>
        this.notifications.emit(tx, {
          type: 'post_pending_review',
          refs: { submissionId, postIds: okIds, authorUserId: actor.userId },
          ...(okIds.length === 1
            ? { params: { postTitle: (okTitles[0] ?? '').slice(0, 60) } }
            : {}),
        }),
      );
    }
    return result;
  }

  async withdraw(postId: string, expectedVersion: number): Promise<PostRecord> {
    const actor = this.actor();
    return tenantTx(async (tx) => {
      const cur = await this.content.loadForUpdate(tx, postId);
      if (cur === null) throw postNotFound();
      if (cur.version !== expectedVersion || cur.status !== 'pending_review') {
        throw await this.staleError(cur, ['draft']);
      }
      if (cur.submittedBy !== actor.userId) throw onlySubmitterCanWithdraw();
      const moved = await this.content.transition(tx, {
        postId,
        expectedVersion,
        from: ['pending_review'],
        to: 'draft',
        event: {
          type: 'withdrawn',
          actorUserId: actor.userId,
          data: { fromVersion: expectedVersion, toVersion: expectedVersion + 1 },
        },
      });
      if (moved.kind !== 'ok') throw await this.resultError(moved, ['draft']);
      await writePostAudit(tx, actor.userId, 'post.withdraw', {
        postId,
        fromVersion: expectedVersion,
        toVersion: moved.post.version,
      });
      return moved.post;
    });
  }

  // ----- trả lại, hủy lịch -------------------------------------------------------------------

  async returnPost(postId: string, expectedVersion: number, note: string): Promise<PostRecord> {
    return this.returnOne(this.actor(), postId, expectedVersion, note);
  }

  private async returnOne(
    actor: Actor,
    postId: string,
    expectedVersion: number,
    note: string,
  ): Promise<PostRecord> {
    return tenantTx(async (tx) => {
      const cur = await this.content.loadForUpdate(tx, postId);
      if (cur === null) throw postNotFound();
      if (cur.version !== expectedVersion || !['pending_review', 'approved'].includes(cur.status)) {
        throw await this.staleError(cur, ['draft']);
      }
      if (cur.status === 'approved') await this.cancelScheduleOrThrow(tx, postId);
      const moved = await this.content.transition(tx, {
        postId,
        expectedVersion,
        from: ['pending_review', 'approved'],
        to: 'draft',
        set: {
          returnedNote: note,
          returnedBy: actor.userId,
          returnedAt: new Date(),
          approvedBy: null,
          approvedAt: null,
          editedAfterApproval: false,
        },
        event: {
          type: 'returned',
          actorUserId: actor.userId,
          data: { fromVersion: expectedVersion, toVersion: expectedVersion + 1, note },
        },
      });
      if (moved.kind !== 'ok') throw await this.resultError(moved, ['draft']);
      await this.notifications.emit(tx, {
        type: 'post_returned',
        refs: {
          postId,
          postVersion: moved.post.version,
          authorUserId: cur.submittedBy ?? cur.createdBy,
        },
        params: { postTitle: this.title(moved.post) },
      });
      await writePostAudit(tx, actor.userId, 'post.return', {
        postId,
        fromVersion: expectedVersion,
        toVersion: moved.post.version,
      });
      return moved.post;
    });
  }

  async returnBatch(
    items: { postId: string; expectedVersion: number }[],
    note: string,
  ): Promise<BulkResult> {
    if (items.length > this.config.POST_BULK_APPROVE_LIMIT) {
      throw bulkLimitExceeded(this.config.POST_BULK_APPROVE_LIMIT);
    }
    const actor = this.actor();
    return this.runBulk(
      items.map((i) => i.postId),
      async (postId, index) => {
        await this.returnOne(actor, postId, items[index]?.expectedVersion ?? 0, note);
      },
    );
  }

  async unschedule(postId: string, expectedVersion: number): Promise<PostRecord> {
    const actor = this.actor();
    return tenantTx(async (tx) => {
      const cur = await this.content.loadForUpdate(tx, postId);
      if (cur === null) throw postNotFound();
      if (cur.version !== expectedVersion || cur.status !== 'approved') {
        throw await this.staleError(cur, ['draft']);
      }
      await this.cancelScheduleOrThrow(tx, postId);
      const moved = await this.content.transition(tx, {
        postId,
        expectedVersion,
        from: ['approved'],
        to: 'draft',
        set: { approvedBy: null, approvedAt: null },
        event: {
          type: 'unscheduled',
          actorUserId: actor.userId,
          data: { fromVersion: expectedVersion, toVersion: expectedVersion + 1 },
        },
      });
      if (moved.kind !== 'ok') throw await this.resultError(moved, ['draft']);
      await writePostAudit(tx, actor.userId, 'post.unschedule', {
        postId,
        fromVersion: expectedVersion,
        toVersion: moved.post.version,
      });
      return moved.post;
    });
  }

  /** Hủy mọi mục chờ giờ của bài; có mục đã bắt đầu đăng → ném (hoàn tác cả giao dịch, không đổi gì). */
  private async cancelScheduleOrThrow(tx: Db, postId: string): Promise<void> {
    const cancelled = await this.publishing.cancelByPost(tx, postId);
    if (cancelled.kind === 'already_publishing') {
      throw channelIssuesError(
        'CHANNEL_ALREADY_PUBLISHING',
        cancelled.connectionIds.map((connectionId) => ({
          connectionId,
          code: 'CHANNEL_ALREADY_PUBLISHING',
          messageVi: 'Kênh này đã bắt đầu đăng bài nên không thay đổi được nữa.',
          remedies: [{ action: 'view_progress', labelVi: 'Xem tiến trình' }],
        })),
      );
    }
  }

  // ----- đổi giờ -----------------------------------------------------------------------------

  async reschedule(
    postId: string,
    expectedVersion: number,
    scheduledAt: Date,
  ): Promise<PostRecord> {
    const actor = this.actor();
    await this.assertLead(scheduledAt);
    return tenantTx(async (tx) => {
      const cur = await this.content.loadForUpdate(tx, postId);
      if (cur === null) throw postNotFound();
      if (cur.version !== expectedVersion) throw await this.staleError(cur, []);
      if (cur.status === 'cancelled') throw postNotEditable();
      return this.rescheduleInTx(tx, actor, cur, scheduledAt);
    });
  }

  /** Bài đã khóa dòng + đúng phiên bản. Đã duyệt → đổi mục lịch đăng; chưa duyệt → chỉ đặt giờ dự kiến. */
  private async rescheduleInTx(
    tx: Db,
    actor: Actor,
    cur: PostRecord,
    scheduledAt: Date,
  ): Promise<PostRecord> {
    if (cur.status === 'approved') {
      const r = await this.publishing.reschedule(tx, cur.id, scheduledAt);
      if (r.kind === 'already_publishing') {
        throw channelIssuesError(
          'CHANNEL_ALREADY_PUBLISHING',
          r.connectionIds.map((connectionId) => ({
            connectionId,
            code: 'CHANNEL_ALREADY_PUBLISHING',
            messageVi: 'Kênh này đã bắt đầu đăng bài nên không đổi giờ được nữa.',
            remedies: [{ action: 'view_progress', labelVi: 'Xem tiến trình' }],
          })),
        );
      }
      if (r.kind === 'quota_exceeded') {
        throw channelIssuesError('CHANNEL_QUOTA_EXCEEDED', [
          {
            connectionId: r.connectionId,
            code: 'CHANNEL_QUOTA_EXCEEDED',
            messageVi: `Kênh này chỉ đăng tối đa ${r.limit} bài trong 24 giờ và đã đủ ở khung giờ mới.`,
            remedies: [{ action: 'choose_other_time', labelVi: 'Chọn giờ khác' }],
          },
        ]);
      }
    }
    const moved = await this.content.transition(tx, {
      postId: cur.id,
      expectedVersion: cur.version,
      from: [cur.status],
      to: cur.status,
      set: { scheduledAt },
      event: {
        type: 'rescheduled',
        actorUserId: actor.userId,
        data: {
          fromVersion: cur.version,
          toVersion: cur.version + 1,
          fromAt: cur.scheduledAt?.toISOString() ?? null,
          toAt: scheduledAt.toISOString(),
        },
      },
    });
    if (moved.kind !== 'ok') throw await this.resultError(moved, []);
    if (cur.status === 'approved' && !actor.isOwner) {
      await this.notifications.emit(tx, {
        type: 'approved_post_rescheduled',
        refs: { postId: cur.id, postVersion: moved.post.version, byUserId: actor.userId },
        params: { postTitle: this.title(moved.post) },
      });
    }
    await writePostAudit(tx, actor.userId, 'post.reschedule', {
      postId: cur.id,
      fromVersion: cur.version,
      toVersion: moved.post.version,
    });
    return moved.post;
  }

  // ----- lưu bài -----------------------------------------------------------------------------

  async savePost(
    postId: string,
    input: { expectedVersion: number; fields: SaveFields },
  ): Promise<PostRecord> {
    const actor = this.actor();
    return tenantTx(async (tx) => {
      const cur = await this.content.loadForUpdate(tx, postId);
      if (cur === null) throw postNotFound();
      if (cur.status === 'cancelled') throw postNotEditable();
      if (cur.status === 'pending_review' && !actor.isOwner) {
        throw postNotEditable(
          'Bài đang chờ chủ tài khoản duyệt nên chưa sửa được. Hãy rút lại bài trước khi sửa.',
        );
      }
      const approved = cur.status === 'approved';
      const newSubmissionId = uuidV7();
      const res = await this.content.saveContent(tx, {
        postId,
        expectedVersion: input.expectedVersion,
        allowedStatuses: [cur.status],
        actorUserId: actor.userId,
        // Bài đã duyệt: giờ đi qua đường đổi giờ riêng, không lưu cùng nội dung.
        fields: approved ? { ...input.fields, scheduledAt: undefined } : input.fields,
        ...(approved
          ? {
              onContentChanged: {
                whenStatus: 'approved' as const,
                to: 'pending_review' as const,
                set: {
                  editedAfterApproval: true,
                  submittedBy: actor.userId,
                  submittedAt: new Date(),
                  submissionId: newSubmissionId,
                  approvedBy: null,
                  approvedAt: null,
                  returnedNote: null,
                  returnedBy: null,
                  returnedAt: null,
                },
                event: {
                  type: 'edited_after_approval' as const,
                  actorUserId: actor.userId,
                  data: { submissionId: newSubmissionId },
                },
              },
            }
          : {}),
      });
      if (res.kind === 'not_found') throw postNotFound();
      if (res.kind === 'wrong_state') throw postNotEditable();
      if (res.kind === 'conflict')
        throw postVersionConflict(await this.content.presentPost(res.current));
      if (res.kind === 'invalid_channels') {
        throw contentInvalidError(
          res.connectionIds.map((connectionId) => ({
            connectionId,
            issues: [
              {
                rule: 'channel_inactive',
                messageVi: 'Kênh này không dùng được (đã ngắt hoặc không thuộc tài khoản của bạn).',
                remedies: [{ action: 'remove_channel', labelVi: 'Bỏ kênh này khỏi bài' }],
              },
            ],
          })),
          [],
        );
      }

      if (!approved) return res.post;

      const requested = input.fields.scheduledAt instanceof Date ? input.fields.scheduledAt : null;
      const wantsNewTime = requested !== null && requested.getTime() !== cur.scheduledAt?.getTime();
      if (res.contentChanged) {
        if (wantsNewTime) throw timeAndContentTogether();
        // Sửa nội dung bài đã duyệt: hủy mục lịch đăng + việc CÙNG giao dịch, không còn đăng nội dung cũ.
        await this.cancelScheduleOrThrow(tx, postId);
        await this.notifications.emit(tx, {
          type: 'post_pending_review',
          refs: { submissionId: newSubmissionId, postIds: [postId], authorUserId: actor.userId },
          params: { postTitle: this.title(res.post) },
        });
        await writePostAudit(tx, actor.userId, 'post.edit_after_approval', {
          postId,
          fromVersion: input.expectedVersion,
          toVersion: res.post.version,
          submissionId: newSubmissionId,
        });
        return res.post;
      }
      if (wantsNewTime) {
        await this.assertLead(requested);
        return this.rescheduleInTx(tx, actor, res.post, requested);
      }
      return res.post;
    });
  }

  // ----- gợi ý giờ, danh sách chờ duyệt ------------------------------------------------------

  async suggestTimes(count: number, after?: Date): Promise<Date[]> {
    const now = new Date();
    const from = after ?? now;
    // Tránh trùng giờ đã có bài trong 60 ngày tới.
    const taken = (
      await this.content.calendar({ from, to: new Date(from.getTime() + 60 * 86_400_000) })
    )
      .map((c) => c.post.scheduledAt)
      .filter((d): d is Date => d !== null);
    return suggestTimes({
      count,
      now,
      after,
      minLeadMinutes: this.config.POST_MIN_LEAD_MINUTES,
      hours: this.config.POST_SUGGEST_HOURS,
      taken,
    });
  }

  async listPending(page: {
    cursor?: string | undefined;
    limit: number;
  }): Promise<PendingListResponse> {
    const result = await this.content.listPendingReview(page);
    const authorIds = [
      ...new Set(result.items.map((i) => i.post.submittedBy ?? i.post.createdBy)),
    ].slice(0, 100);
    const names = await tenantTx(() => this.members.describeMembers(authorIds));
    const nameOf = (id: string): string => {
      const m = names.find((n) => n.userId === id);
      return m?.status === 'active' ? m.displayName : 'Cộng tác viên đã gỡ';
    };
    const items: PendingItem[] = result.items.map(({ post }) => {
      const author = post.submittedBy ?? post.createdBy;
      const labels = this.content.labelsOf(post);
      return {
        postId: post.id,
        title: this.title(post),
        excerpt: Array.from(post.sharedText.replace(/\s+/g, ' ').trim()).slice(0, 140).join(''),
        channelTypes: post.variants.map((v) => v.channelType),
        authorUserId: author,
        authorDisplayName: nameOf(author),
        scheduledAt: post.scheduledAt?.toISOString() ?? null,
        version: post.version,
        timePassed: labels.timePassed,
        returned: labels.returned !== null,
        editedAfterApproval: post.editedAfterApproval,
        submittedAt: post.submittedAt?.toISOString() ?? null,
      };
    });
    return { items, nextCursor: result.nextCursor };
  }
}
