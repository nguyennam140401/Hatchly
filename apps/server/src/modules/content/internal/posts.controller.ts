import { Controller, Delete, Get, HttpCode, Inject, Post } from '@nestjs/common';
import {
  CreatePostRequest,
  DeletePostQuery,
  PostIdParam,
  PostListQuery,
  type ChannelRulesResponse,
  type Post as PostView,
  type PostHistoryResponse,
  type PostListResponse,
} from '@app/shared/content';
import {
  CustomerAccess,
  ValidBody,
  ValidParam,
  ValidQuery,
  can,
  requireCustomer,
  tenantTx,
} from '../../../core';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../../account';
import { CONTENT_PUBLIC_API, type ContentPublicApi } from '../public-api';
import { writePostAudit } from './audit';
import {
  noActiveChannel,
  postContentInvalid,
  postNotEditable,
  postNotFound,
  postVersionConflict,
} from './post-errors';

// Điểm cuối bài viết thuộc `content` (012 contracts/http-api.md mục 2). Mọi điểm cuối khai báo MỘT quyền;
// mã tài khoản và người dùng CHỈ lấy từ phiên. Đọc chi tiết bài kèm trạng thái đăng (`GET /posts/:id`) và
// Lịch nằm ở `approval` vì cần `publishing` (content không được gọi ngược publishing – tệp kê khai).

@Controller()
export class PostsController {
  constructor(
    @Inject(CONTENT_PUBLIC_API) private readonly content: ContentPublicApi,
    @Inject(ACCOUNT_PUBLIC_API) private readonly members: Pick<AccountPublicApi, 'describeMembers'>,
  ) {}

  @Post('posts')
  @CustomerAccess('post.edit')
  @HttpCode(201)
  async create(@ValidBody(CreatePostRequest) body: CreatePostRequest): Promise<PostView> {
    const actor = requireCustomer();
    const result = await tenantTx((db) =>
      this.content.createDraft(db, {
        actorUserId: actor.userId,
        fields: {
          internalName: body.internalName ?? null,
          sharedText: body.sharedText,
          scheduledAt:
            body.scheduledAt === undefined || body.scheduledAt === null
              ? null
              : new Date(body.scheduledAt),
          variants: body.variants,
        },
      }),
    );
    if (result.kind === 'no_active_channel') throw noActiveChannel();
    if (result.kind === 'invalid_channels') {
      throw postContentInvalid(
        result.connectionIds.map((connectionId) => ({
          connectionId,
          issues: [
            {
              rule: 'channel_inactive',
              messageVi: 'Kênh này không dùng được (đã ngắt hoặc không thuộc tài khoản của bạn).',
              remedies: [{ action: 'remove_channel', labelVi: 'Bỏ kênh này khỏi bài' }],
            },
          ],
        })),
      );
    }
    return this.content.presentPost(result.post, { withValidation: true });
  }

  @Get('posts')
  @CustomerAccess('status.view')
  async list(@ValidQuery(PostListQuery) query: PostListQuery): Promise<PostListResponse> {
    const page = await this.content.listPosts({
      status: query.status,
      q: query.q,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { items: this.content.presentSummaries(page.items), nextCursor: page.nextCursor };
  }

  @Delete('posts/:id')
  @CustomerAccess('post.edit')
  @HttpCode(204)
  async deleteDraft(
    @ValidParam(PostIdParam) params: PostIdParam,
    @ValidQuery(DeletePostQuery) query: DeletePostQuery,
  ): Promise<void> {
    const actor = requireCustomer();
    const result = await tenantTx(async (db) => {
      const r = await this.content.deleteDraft(db, params.id, query.expectedVersion, {
        userId: actor.userId,
        isOwner: can('post.approve'),
      });
      if (r.kind === 'ok') {
        await writePostAudit(db, actor.userId, 'post.delete_draft', {
          postId: params.id,
          fromVersion: query.expectedVersion,
          toVersion: query.expectedVersion + 1,
        });
      }
      return r;
    });
    if (result.kind === 'ok') return;
    if (result.kind === 'not_found') throw postNotFound();
    if (result.kind === 'conflict') {
      throw postVersionConflict(await this.content.presentPost(result.current));
    }
    throw postNotEditable(
      'Chỉ xóa được bài đang ở trạng thái Nháp. Với bài đã lên lịch, hãy Hủy lịch trước.',
    );
  }

  @Get('posts/:id/history')
  @CustomerAccess('status.view')
  async history(@ValidParam(PostIdParam) params: PostIdParam): Promise<PostHistoryResponse> {
    const post = await this.content.getPost(params.id);
    if (post === null) throw postNotFound();
    const events = await this.content.listEvents(params.id);
    const names = await tenantTx(() =>
      this.members.describeMembers([...new Set(events.map((e) => e.actorUserId))].slice(0, 100)),
    );
    const nameOf = (id: string): string => {
      const m = names.find((n) => n.userId === id);
      if (m === undefined) return 'Cộng tác viên đã gỡ';
      return m.status === 'active' ? m.displayName : `${m.displayName} (đã gỡ)`;
    };
    return {
      events: events.map((e) => ({
        type: e.type,
        actorUserId: e.actorUserId,
        actorDisplayName: nameOf(e.actorUserId),
        at: e.occurredAt.toISOString(),
        data: e.data,
      })),
    };
  }

  @Get('channel-rules')
  @CustomerAccess('status.view')
  async channelRules(): Promise<ChannelRulesResponse> {
    return { rules: await this.content.channelRules() };
  }
}
