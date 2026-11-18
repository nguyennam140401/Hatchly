import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  acceptExistingRequest,
  invitationAcceptRequest,
  invitationPreviewRequest,
  type AcceptExistingRequest,
  type InvitationAcceptRequest,
  type InvitationPreviewRequest,
  type InvitationPreviewResponse,
  type MeResponse,
  type MyInvitationsResponse,
} from '@app/shared/auth';
import type { Request, Response } from 'express';
import { currentActor, CustomerAccess, Public, requireCustomer, ValidBody } from '../../../../core';
import { CUSTOMER_SESSION_COOKIE, setSessionCookie } from '../../../../core/auth/cookies';
import { requestMeta, secondsUntil } from './http';
import { InvitationsService } from './invitations.service';
import type { IssuedSession } from './session.service';

// Lời mời – phía người được mời (009, contracts/auth-http-api.md mục 4). Mã lời mời đi trong THÂN yêu
// cầu (không ở đường dẫn/truy vấn) nên không lọt vào nhật ký.

@Controller('invitations')
export class InvitationsController {
  constructor(@Inject(InvitationsService) private readonly invitations: InvitationsService) {}

  private setSession(res: Response, session: IssuedSession): void {
    setSessionCookie(
      res,
      CUSTOMER_SESSION_COOKIE,
      session.token,
      secondsUntil(session.absoluteExpiresAt),
    );
  }

  @Post('preview')
  @Public()
  @HttpCode(200)
  preview(
    @ValidBody(invitationPreviewRequest) body: InvitationPreviewRequest,
  ): Promise<InvitationPreviewResponse> {
    return this.invitations.preview(body.token);
  }

  @Post('accept')
  @Public()
  @HttpCode(200)
  async accept(
    @ValidBody(invitationAcceptRequest) body: InvitationAcceptRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const actor = currentActor();
    const result = await this.invitations.acceptWithPassword(
      body,
      actor?.kind === 'user' ? actor : null,
      requestMeta(req),
    );
    this.setSession(res, result.session);
    return result.me;
  }

  @Get('mine')
  @CustomerAccess({ allowDetached: true })
  mine(): Promise<MyInvitationsResponse> {
    return this.invitations.mine(requireCustomer());
  }

  @Post('accept-existing')
  @CustomerAccess({ allowDetached: true })
  @HttpCode(200)
  async acceptExisting(
    @ValidBody(acceptExistingRequest) body: AcceptExistingRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const result = await this.invitations.acceptExisting(requireCustomer(), body, requestMeta(req));
    this.setSession(res, result.session);
    return result.me;
  }
}
