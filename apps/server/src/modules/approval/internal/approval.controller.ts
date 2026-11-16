import { Controller, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import {
  ApproveBatchRequest,
  ApproveRequest,
  PendingQuery,
  RescheduleRequest,
  ReturnBatchRequest,
  ReturnRequest,
  SubmitRequest,
  SuggestTimesRequest,
  VersionOnlyRequest,
  normalizeReturnNote,
  type BulkResult,
  type PendingCountResponse,
  type PendingListResponse,
  type SuggestTimesResponse,
} from '@app/shared/approval';
import {
  CalendarQuery,
  PostIdParam,
  UpdatePostRequest,
  type CalendarItem,
  type CalendarResponse,
  type Post as PostView,
  type PostDetailResponse,
} from '@app/shared/content';
import { CustomerAccess, ValidBody, ValidParam, ValidQuery } from '../../../core';
import { CONTENT_PUBLIC_API, type ContentPublicApi } from '../../content';
import { PUBLISHING_PUBLIC_API, type PublishingPublicApi } from '../../publishing';
import { APPROVAL_PUBLIC_API, type ApprovalPublicApi } from '../public-api';
import { returnNoteRequired } from './approval-errors';
import { postNotFound } from './post-errors';

// Điểm cuối gửi duyệt, duyệt, trả lại, lịch (012 contracts/http-api.md mục 2). MỖI handler có đúng một
// khai báo quyền; quyền kiểm ở API (không chỉ ẩn trên giao diện). Mã tài khoản/người dùng CHỈ từ phiên.
// Đọc chi tiết bài kèm trạng thái đăng và Lịch nằm ở đây vì cần cả `content` lẫn `publishing`.

@Controller()
export class ApprovalController {
  constructor(
    @Inject(APPROVAL_PUBLIC_API) private readonly approval: ApprovalPublicApi,
    @Inject(CONTENT_PUBLIC_API) private readonly content: ContentPublicApi,
    @Inject(PUBLISHING_PUBLIC_API) private readonly publishing: PublishingPublicApi,
  ) {}

  private view(post: Parameters<ContentPublicApi['presentPost']>[0]): Promise<PostView> {
    return this.content.presentPost(post, { withValidation: true });
  }

  // ----- đọc ---------------------------------------------------------------------------------

  @Get('posts/:id')
  @CustomerAccess('status.view')
  async getPost(@ValidParam(PostIdParam) params: PostIdParam): Promise<PostDetailResponse> {
    const record = await this.content.getPost(params.id);
    if (record === null) throw postNotFound();
    const post = await this.view(record);
    const states = await this.publishing.statusesByPosts([params.id]);
    return {
      post,
      validation: post.variants
        .filter((v) => v.issues.length > 0)
        .map((v) => ({ connectionId: v.connectionId, issues: v.issues })),
      attempts: (states.get(params.id)?.attempts ?? []).map((a) => ({
        connectionId: a.connectionId,
        channelType: a.channelType,
        status: a.status,
        scheduledAt: a.scheduledAt.toISOString(),
      })),
    };
  }

  @Get('calendar')
  @CustomerAccess('status.view')
  async calendar(@ValidQuery(CalendarQuery) query: CalendarQuery): Promise<CalendarResponse> {
    const records = await this.content.calendar({
      from: new Date(query.from),
      to: new Date(query.to),
    });
    const states = await this.publishing.statusesByPosts(records.map((r) => r.post.id));
    const info = await this.content.channelInfo([
      ...new Set(records.flatMap((r) => r.post.variants.map((v) => v.connectionId))),
    ]);
    const items: CalendarItem[] = records.map(({ post }) => {
      const state = states.get(post.id);
      const summary = this.content.presentSummaries([post])[0];
      if (summary === undefined) throw new Error('Không dựng được tóm tắt bài');
      let movable = true;
      let reason: string | null = null;
      if (post.status === 'cancelled') {
        movable = false;
        reason = 'Bài đã hủy nên không đổi giờ được.';
      } else if (post.status === 'approved' && state !== undefined && !state.allScheduled) {
        movable = false;
        reason = 'Bài đã bắt đầu đăng hoặc đã đăng nên không đổi giờ được.';
      }
      return {
        postId: post.id,
        title: summary.title,
        scheduledAt: (post.scheduledAt ?? new Date(0)).toISOString(),
        status: post.status,
        version: post.version,
        labels: summary.labels,
        channels: post.variants.map((v) => ({
          channelType: v.channelType,
          displayName: info.get(v.connectionId)?.displayName ?? null,
          attemptStatus:
            state?.attempts.find((a) => a.connectionId === v.connectionId)?.status ?? null,
        })),
        movable,
        movableReason: reason,
      };
    });
    return { items };
  }

  @Get('approvals/pending')
  @CustomerAccess('post.approve')
  listPending(@ValidQuery(PendingQuery) query: PendingQuery): Promise<PendingListResponse> {
    return this.approval.listPending({ cursor: query.cursor, limit: query.limit });
  }

  @Get('approvals/pending/count')
  @CustomerAccess('post.approve')
  async pendingCount(): Promise<PendingCountResponse> {
    return { count: await this.content.countPendingReview() };
  }

  // ----- ghi ---------------------------------------------------------------------------------

  @Put('posts/:id')
  @CustomerAccess('post.edit')
  async save(
    @ValidParam(PostIdParam) params: PostIdParam,
    @ValidBody(UpdatePostRequest) body: UpdatePostRequest,
  ): Promise<PostView> {
    const post = await this.approval.savePost(params.id, {
      expectedVersion: body.expectedVersion,
      fields: {
        internalName: body.internalName ?? null,
        sharedText: body.sharedText,
        scheduledAt:
          body.scheduledAt === undefined
            ? undefined
            : body.scheduledAt === null
              ? null
              : new Date(body.scheduledAt),
        variants: body.variants,
      },
    });
    return this.view(post);
  }

  @Post('posts/submit')
  @CustomerAccess('post.edit')
  @HttpCode(200)
  submit(@ValidBody(SubmitRequest) body: SubmitRequest): Promise<BulkResult> {
    return this.approval.submit({
      items: body.items.map((i) => ({
        postId: i.postId,
        expectedVersion: i.expectedVersion,
        scheduledAt: i.scheduledAt === undefined ? undefined : new Date(i.scheduledAt),
      })),
    });
  }

  @Post('posts/:id/withdraw')
  @CustomerAccess('post.edit')
  @HttpCode(200)
  async withdraw(
    @ValidParam(PostIdParam) params: PostIdParam,
    @ValidBody(VersionOnlyRequest) body: VersionOnlyRequest,
  ): Promise<PostView> {
    return this.view(await this.approval.withdraw(params.id, body.expectedVersion));
  }

  @Post('posts/:id/approve')
  @CustomerAccess('post.approve')
  @HttpCode(200)
  async approve(
    @ValidParam(PostIdParam) params: PostIdParam,
    @ValidBody(ApproveRequest) body: ApproveRequest,
  ): Promise<PostView> {
    const post = await this.approval.approve(
      params.id,
      body.expectedVersion,
      new Date(body.scheduledAt),
    );
    return this.view(post);
  }

  @Post('approvals/approve-batch')
  @CustomerAccess('post.approve')
  @HttpCode(200)
  approveBatch(@ValidBody(ApproveBatchRequest) body: ApproveBatchRequest): Promise<BulkResult> {
    return this.approval.approveBatch(
      body.items.map((i) => ({
        postId: i.postId,
        expectedVersion: i.expectedVersion,
        scheduledAt: i.scheduledAt === undefined ? undefined : new Date(i.scheduledAt),
      })),
    );
  }

  @Post('posts/:id/return')
  @CustomerAccess('post.approve')
  @HttpCode(200)
  async returnPost(
    @ValidParam(PostIdParam) params: PostIdParam,
    @ValidBody(ReturnRequest) body: ReturnRequest,
  ): Promise<PostView> {
    const note = normalizeReturnNote(body.note);
    if (note === null) throw returnNoteRequired();
    return this.view(await this.approval.returnPost(params.id, body.expectedVersion, note));
  }

  @Post('approvals/return-batch')
  @CustomerAccess('post.approve')
  @HttpCode(200)
  returnBatch(@ValidBody(ReturnBatchRequest) body: ReturnBatchRequest): Promise<BulkResult> {
    const note = normalizeReturnNote(body.note);
    if (note === null) throw returnNoteRequired();
    return this.approval.returnBatch(body.items, note);
  }

  @Post('posts/:id/unschedule')
  @CustomerAccess('post.approve')
  @HttpCode(200)
  async unschedule(
    @ValidParam(PostIdParam) params: PostIdParam,
    @ValidBody(VersionOnlyRequest) body: VersionOnlyRequest,
  ): Promise<PostView> {
    return this.view(await this.approval.unschedule(params.id, body.expectedVersion));
  }

  @Put('posts/:id/schedule')
  @CustomerAccess('post.reschedule')
  async reschedule(
    @ValidParam(PostIdParam) params: PostIdParam,
    @ValidBody(RescheduleRequest) body: RescheduleRequest,
  ): Promise<PostView> {
    const post = await this.approval.reschedule(
      params.id,
      body.expectedVersion,
      new Date(body.scheduledAt),
    );
    return this.view(post);
  }

  @Post('approvals/suggest-times')
  @CustomerAccess('post.edit')
  @HttpCode(200)
  async suggest(
    @ValidBody(SuggestTimesRequest) body: SuggestTimesRequest,
  ): Promise<SuggestTimesResponse> {
    const times = await this.approval.suggestTimes(
      body.count,
      body.after === undefined ? undefined : new Date(body.after),
    );
    return { times: times.map((t) => t.toISOString()) };
  }
}
