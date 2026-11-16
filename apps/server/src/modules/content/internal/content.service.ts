// Hiện thực `ContentPublicApi` (012 contracts/module-api.md mục 1). Hàm nhận `tx: Db` chạy TRONG giao dịch
// của người gọi; không gọi nền tảng bên ngoài khi đang giữ giao dịch (chỉ đọc kết nối cục bộ của cổng).
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { APP_CONFIG, tenantTx, uuidV7, type AppConfig, type Db } from '../../../core';
import {
  PLATFORM_GATEWAY,
  validateMedia,
  type ChannelConnection,
  type PlatformGatewayPublicApi,
} from '../../platform_gateway';
import {
  MEDIA_DESCRIBER,
  type CalendarRecord,
  type ChannelRule,
  type ContentPublicApi,
  type CreateDraftInput,
  type CreateDraftResult,
  type DeleteResult,
  type MediaDescriber,
  type Page,
  type Paged,
  type PendingRecord,
  type PostEventInput,
  type PostEventRecord,
  type PostListFilter,
  type PostRecord,
  type SaveContentInput,
  type SaveContentResult,
  type SaveFields,
  type TransitionInput,
  type TransitionResult,
  type ValidationResult,
} from '../public-api';
import { loadChannelRules } from './channel-rules';
import { labelsOf, toPostView, toSummaryView } from './post-view';
import { channelVariants, posts } from './db/schema';
import {
  accountIdOrThrow,
  appendEvent,
  attachVariants,
  contentFingerprint,
  countPending,
  listCalendarRows,
  listEventRows,
  listPendingRows,
  listPostRows,
  loadPost,
  loadPostsByIds,
  setToColumns,
  transitionPost,
} from './posts.repository';
import {
  channelInactiveRule,
  effectiveText,
  emptyRule,
  hashtagsRule,
  mediaRequiredRule,
  mediaUnverifiableRule,
  textLengthRule,
} from './validation/rules';
import type { ValidationIssue, VariantInput } from '@app/shared/content';

type ChannelStatus = 'active' | 'expiring' | 'expired' | 'disconnected' | 'unknown';

const isUsable = (c: ChannelConnection | null): c is ChannelConnection =>
  c !== null && (c.status === 'active' || c.status === 'expiring');

@Injectable()
export class ContentService implements ContentPublicApi {
  constructor(
    @Inject(PLATFORM_GATEWAY) private readonly gateway: PlatformGatewayPublicApi,
    @Optional() @Inject(MEDIA_DESCRIBER) private readonly media: MediaDescriber | undefined,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, 'POST_MIN_LEAD_MINUTES'>,
  ) {}

  async presentPost(post: PostRecord, options: { withValidation?: boolean } = {}) {
    const info = await this.channelInfo(post.variants.map((v) => v.connectionId));
    const issues = new Map<string, ValidationIssue[]>();
    if (options.withValidation === true) {
      for (const r of await this.validateForDisplay(post)) issues.set(r.connectionId, r.issues);
    }
    return toPostView(post, info, issues, new Date(), this.config.POST_MIN_LEAD_MINUTES);
  }

  presentSummaries(items: readonly PostRecord[]) {
    const now = new Date();
    return items.map((p) => toSummaryView(p, now, this.config.POST_MIN_LEAD_MINUTES));
  }

  labelsOf(post: PostRecord) {
    return labelsOf(post, new Date(), this.config.POST_MIN_LEAD_MINUTES);
  }

  // ----- đọc ---------------------------------------------------------------------------------

  async getPost(id: string): Promise<PostRecord | null> {
    return this.read((db) => loadPost(db, id));
  }

  async getPosts(ids: readonly string[]): Promise<PostRecord[]> {
    return this.read((db) => loadPostsByIds(db, ids));
  }

  async listPosts(filter: PostListFilter): Promise<Paged<PostRecord>> {
    return this.read(async (db) => {
      const { rows, nextCursor } = await listPostRows(db, filter);
      return { items: await attachVariants(db, rows), nextCursor };
    });
  }

  async listPendingReview(page: Page): Promise<Paged<PendingRecord>> {
    return this.read(async (db) => {
      const { rows, nextCursor } = await listPendingRows(db, page);
      const items = (await attachVariants(db, rows)).map((post) => ({ post }));
      return { items, nextCursor };
    });
  }

  async countPendingReview(): Promise<number> {
    return this.read((db) => countPending(db));
  }

  async calendar(range: { from: Date; to: Date }): Promise<CalendarRecord[]> {
    return this.read(async (db) => {
      const rows = await listCalendarRows(db, range.from, range.to);
      return (await attachVariants(db, rows)).map((post) => ({ post }));
    });
  }

  async listEvents(postId: string): Promise<PostEventRecord[]> {
    return this.read((db) => listEventRows(db, postId));
  }

  channelRules(): Promise<ChannelRule[]> {
    return loadChannelRules();
  }

  // ----- thao tác trong giao dịch ------------------------------------------------------------

  loadForUpdate(tx: Db, id: string): Promise<PostRecord | null> {
    return loadPost(tx, id, true);
  }

  // Giờ đăng không ảnh hưởng kiểm tra nội dung (hạn mức theo giờ do `publishing` kiểm).
  async validateForScheduling(tx: Db, post: PostRecord, at: Date): Promise<ValidationResult> {
    if (Number.isNaN(at.getTime())) throw new Error('validateForScheduling: giờ đăng không hợp lệ');
    const contentIssues: ValidationIssue[] = [];
    if (post.variants.length === 0) {
      contentIssues.push({
        rule: 'empty',
        messageVi: 'Bài chưa chọn kênh nào. Hãy chọn ít nhất một kênh để đăng.',
        remedies: [{ action: 'edit_text', labelVi: 'Chọn kênh' }],
      });
    }
    const channelIssues = await this.checkVariants(tx, post, 'schedule');
    if (contentIssues.length === 0 && channelIssues.length === 0) return { ok: true };
    return { ok: false, channelIssues, contentIssues };
  }

  /** Kiểm tra hiển thị (không chặn lưu): cùng quy tắc, KHÔNG báo "chưa kiểm được media". */
  async validateForDisplay(
    post: PostRecord,
  ): Promise<{ connectionId: string; issues: ValidationIssue[] }[]> {
    const issues = await this.read((db) => this.checkVariants(db, post, 'display'));
    return issues.map((i) => ({ connectionId: i.connectionId, issues: i.issues }));
  }

  async transition(tx: Db, input: TransitionInput): Promise<TransitionResult> {
    return transitionPost(tx, input);
  }

  async appendEvent(tx: Db, postId: string, event: PostEventInput): Promise<void> {
    await appendEvent(tx, postId, event);
  }

  async createDraft(tx: Db, input: CreateDraftInput): Promise<CreateDraftResult> {
    const connections = await this.gateway.listConnections();
    if (!connections.some(isUsable)) return { kind: 'no_active_channel' };
    const byId = new Map(connections.map((c) => [c.connectionId, c]));
    const invalid = input.fields.variants
      .filter((v) => !isUsable(byId.get(v.connectionId) ?? null))
      .map((v) => v.connectionId);
    if (invalid.length > 0) return { kind: 'invalid_channels', connectionIds: invalid };

    const accountId = accountIdOrThrow();
    const id = uuidV7();
    await tx.insert(posts).values({
      id,
      account_id: accountId,
      status: 'draft',
      source: 'manual',
      internal_name: nameOrNull(input.fields.internalName),
      shared_text: input.fields.sharedText,
      scheduled_at: input.fields.scheduledAt ?? null,
      created_by: input.actorUserId,
    });
    for (const v of input.fields.variants) {
      await tx
        .insert(channelVariants)
        .values(
          variantRow(accountId, id, v, byId.get(v.connectionId)?.channelType ?? 'test_channel'),
        );
    }
    await appendEvent(tx, id, {
      type: 'created',
      actorUserId: input.actorUserId,
      data: { toVersion: 1 },
    });
    const post = await loadPost(tx, id);
    if (post === null) throw new Error('Bài vừa tạo nhưng không đọc lại được');
    return { kind: 'ok', post };
  }

  async saveContent(tx: Db, input: SaveContentInput): Promise<SaveContentResult> {
    const before = await loadPost(tx, input.postId, true);
    if (before === null) return { kind: 'not_found' };
    if (!input.allowedStatuses.includes(before.status)) {
      return { kind: 'wrong_state', current: before };
    }
    if (before.version !== input.expectedVersion) return { kind: 'conflict', current: before };

    const f = input.fields;
    const existing = new Map(before.variants.map((v) => [v.connectionId, v]));
    // Chỉ kênh MỚI thêm vào bài phải còn hoạt động; kênh đã có giữ nguyên nội dung dù kênh đã hỏng.
    const added = f.variants.filter((v) => !existing.has(v.connectionId));
    const connections = new Map<string, ChannelConnection | null>();
    for (const v of added) {
      connections.set(v.connectionId, await this.gateway.getConnection(v.connectionId));
    }
    const invalid = added.filter((v) => !isUsable(connections.get(v.connectionId) ?? null));
    if (invalid.length > 0) {
      return { kind: 'invalid_channels', connectionIds: invalid.map((v) => v.connectionId) };
    }

    const accountId = accountIdOrThrow();
    const keep = new Set(f.variants.map((v) => v.connectionId));
    const removed = before.variants.filter((v) => !keep.has(v.connectionId));
    if (removed.length > 0) {
      await tx.delete(channelVariants).where(
        and(
          eq(channelVariants.post_id, before.id),
          inArray(
            channelVariants.id,
            removed.map((v) => v.id),
          ),
        ),
      );
    }
    for (const v of f.variants) {
      const prior = existing.get(v.connectionId);
      if (prior === undefined) {
        await tx
          .insert(channelVariants)
          .values(
            variantRow(
              accountId,
              before.id,
              v,
              connections.get(v.connectionId)?.channelType ?? 'test_channel',
            ),
          );
      } else if (variantDiffers(prior, v)) {
        await tx
          .update(channelVariants)
          .set({
            customized: v.customized,
            text: v.customized ? v.text : '',
            hashtags: v.hashtags,
            media: v.media,
            version: sql`${channelVariants.version} + 1`,
            updated_at: sql`now()`,
          })
          .where(eq(channelVariants.id, prior.id));
      }
    }

    // Tính "nội dung đổi" trên dữ liệu SAU khi áp (đọc lại để chắc chắn khớp CSDL).
    const afterVariants = (await loadPost(tx, before.id))?.variants ?? [];
    const contentChanged =
      contentFingerprint(before) !==
      contentFingerprint({ sharedText: f.sharedText, variants: afterVariants });
    const setsStatus =
      input.onContentChanged !== undefined &&
      contentChanged &&
      before.status === input.onContentChanged.whenStatus;

    const update: Record<string, unknown> = {
      internal_name: nameOrNull(f.internalName),
      shared_text: f.sharedText,
      version: sql`${posts.version} + 1`,
      updated_at: sql`now()`,
    };
    if (f.scheduledAt !== undefined) update.scheduled_at = f.scheduledAt;
    if (setsStatus && input.onContentChanged !== undefined) {
      Object.assign(update, { status: input.onContentChanged.to });
      Object.assign(update, setToColumns(input.onContentChanged.set));
    }
    const rows = await tx
      .update(posts)
      .set(update)
      .where(
        and(
          eq(posts.id, before.id),
          eq(posts.version, input.expectedVersion),
          isNull(posts.deleted_at),
        ),
      )
      .returning({ id: posts.id });
    if (rows[0] === undefined) {
      // Đã khóa dòng ở đầu hàm nên hiếm khi tới đây; vẫn trả xung đột thay vì ghi đè.
      const current = await loadPost(tx, before.id);
      return current === null ? { kind: 'not_found' } : { kind: 'conflict', current };
    }

    if (removed.length > 0 || added.length > 0) {
      await appendEvent(tx, before.id, {
        type: 'channels_changed',
        actorUserId: input.actorUserId,
        data: { fromVersion: before.version, toVersion: before.version + 1 },
      });
    }
    if (setsStatus && input.onContentChanged !== undefined) {
      await appendEvent(tx, before.id, {
        ...input.onContentChanged.event,
        data: {
          ...input.onContentChanged.event.data,
          fromVersion: before.version,
          toVersion: before.version + 1,
        },
      });
    }
    const post = await loadPost(tx, before.id);
    if (post === null) throw new Error('Bài vừa lưu nhưng không đọc lại được');
    return { kind: 'ok', post, contentChanged, before, statusChanged: setsStatus };
  }

  async deleteDraft(
    tx: Db,
    id: string,
    expectedVersion: number,
    actor: { userId: string; isOwner: boolean },
  ): Promise<DeleteResult> {
    const current = await loadPost(tx, id, true);
    if (current === null) return { kind: 'not_found' };
    if (current.status !== 'draft') return { kind: 'not_draft', current };
    if (!actor.isOwner && current.createdBy !== actor.userId) {
      return { kind: 'not_draft', current };
    }
    if (current.version !== expectedVersion) return { kind: 'conflict', current };
    await tx
      .update(posts)
      .set({ deleted_at: sql`now()`, version: sql`${posts.version} + 1`, updated_at: sql`now()` })
      .where(and(eq(posts.id, id), eq(posts.version, expectedVersion)));
    return { kind: 'ok' };
  }

  // ----- nội bộ ------------------------------------------------------------------------------

  /** Trạng thái hiển thị của từng kênh (đọc cục bộ; không gọi nền tảng ngoài). */
  async channelInfo(
    connectionIds: readonly string[],
  ): Promise<Map<string, { status: ChannelStatus; displayName: string | null }>> {
    const out = new Map<string, { status: ChannelStatus; displayName: string | null }>();
    const all = await this.gateway.listConnections();
    const byId = new Map(all.map((c) => [c.connectionId, c]));
    for (const id of connectionIds) {
      const c = byId.get(id);
      out.set(id, { status: c?.status ?? 'unknown', displayName: c?.displayName ?? null });
    }
    return out;
  }

  private async checkVariants(
    tx: Db | undefined,
    post: PostRecord,
    mode: 'display' | 'schedule',
  ): Promise<
    {
      connectionId: string;
      channelType: PostRecord['variants'][number]['channelType'];
      issues: ValidationIssue[];
    }[]
  > {
    const rules = await loadChannelRules(tx);
    const info = await this.channelInfo(post.variants.map((v) => v.connectionId));
    const result: {
      connectionId: string;
      channelType: PostRecord['variants'][number]['channelType'];
      issues: ValidationIssue[];
    }[] = [];
    for (const v of post.variants) {
      const rule = rules.find((r) => r.channelType === v.channelType);
      const text = effectiveText(v, post.sharedText);
      const issues: ValidationIssue[] = [
        ...channelInactiveRule(info.get(v.connectionId)?.status ?? 'unknown'),
        ...emptyRule(text, v.media.length),
      ];
      if (rule !== undefined) {
        issues.push(
          ...textLengthRule(text, rule),
          ...hashtagsRule(v.hashtags, rule),
          ...mediaRequiredRule(v.media.length, rule),
        );
      }
      if (v.media.length > 0 || rule?.mediaRequired === true) {
        issues.push(...(await this.mediaIssues(v, mode, rule?.mediaRequired === true)));
      }
      if (issues.length > 0) {
        result.push({ connectionId: v.connectionId, channelType: v.channelType, issues });
      }
    }
    return result;
  }

  /** Quy tắc media chi tiết (định dạng, kích thước, thời lượng) lấy từ cổng + cổng mô tả media (nếu có). */
  private async mediaIssues(
    v: PostRecord['variants'][number],
    mode: 'display' | 'schedule',
    mediaRequired: boolean,
  ): Promise<ValidationIssue[]> {
    if (v.media.length === 0) return [];
    if (this.media === undefined) {
      // FR-007: kênh BẮT BUỘC media mà chưa kiểm được → chưa thể lên lịch (chỉ chặn lúc lên lịch).
      // Kênh không bắt buộc media: không kiểm được thì không chặn (013 kiểm lại lúc chuẩn bị media).
      return mode === 'schedule' && mediaRequired ? mediaUnverifiableRule() : [];
    }
    const descriptors = await this.media.describe(v.media.map((m) => m.mediaId));
    const { rules } = await this.gateway.mediaRules(v.connectionId);
    return validateMedia(rules, descriptors).map((violation) => ({
      rule: 'media_rule' as const,
      messageVi: violation.messageVi,
      remedies: [{ action: 'edit_media' as const, labelVi: 'Đổi ảnh hoặc video' }],
    }));
  }

  private async read<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return tenantTx(fn);
  }
}

const nameOrNull = (name: string | null | undefined): string | null => {
  const t = name?.trim();
  return t === undefined || t === '' ? null : t;
};

function variantRow(accountId: string, postId: string, v: VariantInput, channelType: string) {
  return {
    id: uuidV7(),
    account_id: accountId,
    post_id: postId,
    connection_id: v.connectionId,
    channel_type: channelType,
    customized: v.customized,
    text: v.customized ? v.text : '',
    hashtags: v.hashtags,
    media: v.media,
  };
}

function variantDiffers(prior: PostRecord['variants'][number], v: VariantInput): boolean {
  return (
    prior.customized !== v.customized ||
    (v.customized && prior.text !== v.text) ||
    (!v.customized && prior.text !== '') ||
    JSON.stringify(prior.hashtags) !== JSON.stringify(v.hashtags) ||
    JSON.stringify(prior.media) !== JSON.stringify(v.media)
  );
}

export type { SaveFields };
