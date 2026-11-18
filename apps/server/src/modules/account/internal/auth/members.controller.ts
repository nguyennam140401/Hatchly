import { Controller, Delete, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  inviteRequest,
  type InvitationView,
  type InviteRequest,
  type MembersResponse,
} from '@app/shared/auth';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CustomerAccess, requireCustomer, ValidBody, ValidParam } from '../../../../core';
import { notFound } from './errors';
import { requestMeta } from './http';
import { InvitationsService } from './invitations.service';
import { MembersService } from './members.service';

// Thành viên của tài khoản (009, contracts/auth-http-api.md mục 3) – CHỈ chủ (`members.manage`).
// Tài khoản luôn lấy từ phiên; mã lời mời / người dùng của tài khoản khác → 404 (RLS).

const idParam = z.object({ id: z.uuid() });
const userParam = z.object({ userId: z.uuid() });

@Controller('members')
export class MembersController {
  constructor(
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
    @Inject(MembersService) private readonly members: MembersService,
  ) {}

  @Get()
  @CustomerAccess('members.manage')
  list(): Promise<MembersResponse> {
    return this.invitations.list();
  }

  @Post('invitations')
  @CustomerAccess('members.manage')
  async invite(
    @ValidBody(inviteRequest) body: InviteRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<InvitationView> {
    const { view, created } = await this.invitations.invite(
      requireCustomer(),
      body.email,
      requestMeta(req),
    );
    // Email đang có lời mời chờ → 200, coi là "Gửi lại".
    res.status(created ? 201 : 200);
    return view;
  }

  @Post('invitations/:id/resend')
  @CustomerAccess('members.manage')
  @HttpCode(200)
  resend(
    @ValidParam(idParam) params: z.infer<typeof idParam>,
    @Req() req: Request,
  ): Promise<InvitationView> {
    return this.invitations.resend(requireCustomer(), params.id, requestMeta(req));
  }

  @Delete('invitations/:id')
  @CustomerAccess('members.manage')
  @HttpCode(204)
  cancel(@ValidParam(idParam) params: z.infer<typeof idParam>, @Req() req: Request): Promise<void> {
    return this.invitations.cancel(requireCustomer(), params.id, requestMeta(req));
  }

  @Delete(':userId')
  @CustomerAccess('members.manage')
  @HttpCode(204)
  async remove(
    @ValidParam(userParam) params: z.infer<typeof userParam>,
    @Req() req: Request,
  ): Promise<void> {
    const actor = requireCustomer();
    const outcome = await this.members.removeMember({
      accountId: actor.accountId,
      userId: params.userId,
      byUserId: actor.userId,
      meta: requestMeta(req),
    });
    if (outcome === 'not_found') throw notFound();
  }
}
