// Điểm cuối web của Tiến trình đăng (013 contracts/publishing-http-api.md). MỖI handler có đúng một khai báo quyền;
// quyền kiểm ở API. Mã tài khoản/người dùng CHỈ từ phiên; mã lượt đăng không đủ để vượt tenant (RLS → 404).
import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  AttemptIdParam,
  MarkPublishedRequest,
  PostProgressParam,
  RepublishRequest,
  type MarkPublishedResponse,
  type PublishProgressView,
  type RepublishResponse,
  type SupportAttemptDetails,
} from '@app/shared/publishing';
import { CustomerAccess, requireCustomer, ValidBody, ValidParam } from '../../../core';
import { AttemptActionsService } from './attempt-actions.service';
import { ProgressQuery } from './progress.query';

@Controller()
export class AttemptsController {
  constructor(
    @Inject(ProgressQuery) private readonly progress: ProgressQuery,
    @Inject(AttemptActionsService) private readonly actions: AttemptActionsService,
  ) {}

  @Get('posts/:postId/publish-progress')
  @CustomerAccess('status.view')
  async getProgress(
    @ValidParam(PostProgressParam) params: PostProgressParam,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublishProgressView | undefined> {
    const { view, etag } = await this.progress.progress(params.postId);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match'] === etag) {
      res.status(304);
      return undefined;
    }
    return view;
  }

  @Post('publish-attempts/:attemptId/republish')
  @HttpCode(200)
  @CustomerAccess('post.republish')
  republish(
    @ValidParam(AttemptIdParam) params: AttemptIdParam,
    @ValidBody(RepublishRequest) body: RepublishRequest,
  ): Promise<RepublishResponse> {
    return this.actions.republish(params.attemptId, body.version, requireCustomer().userId);
  }

  @Post('publish-attempts/:attemptId/mark-published')
  @HttpCode(200)
  @CustomerAccess('post.republish')
  markPublished(
    @ValidParam(AttemptIdParam) params: AttemptIdParam,
    @ValidBody(MarkPublishedRequest) body: MarkPublishedRequest,
  ): Promise<MarkPublishedResponse> {
    return this.actions.markPublished(
      params.attemptId,
      body.version,
      body.permalink,
      requireCustomer().userId,
    );
  }

  @Get('publish-attempts/:attemptId/support-details')
  @CustomerAccess('status.view')
  supportDetails(
    @ValidParam(AttemptIdParam) params: AttemptIdParam,
  ): Promise<SupportAttemptDetails> {
    return this.actions.supportDetails(params.attemptId);
  }
}
