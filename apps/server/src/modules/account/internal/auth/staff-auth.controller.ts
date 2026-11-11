import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { staffLoginInput, type StaffLoginInput, type StaffMeResponse } from '@app/shared/auth';
import type { Request, Response } from 'express';
import { Public, requireStaff, StaffAccess, ValidBody } from '../../../../core';
import { unauthenticated } from '../../../../core/auth/auth-errors';
import {
  clearSessionCookie,
  setSessionCookie,
  STAFF_SESSION_COOKIE,
} from '../../../../core/auth/cookies';
import { cookieTokenHash, requestMeta, withRetryAfter } from './http';
import { StaffService } from './staff.service';

// Lối vào nội bộ (contracts/auth-http-api.md mục 2), tiền tố /api/v1/internal/auth. Cookie
// __Host-staff_sid là cookie phiên trình duyệt (không Max-Age).

@Controller('internal/auth')
export class StaffAuthController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @ValidBody(staffLoginInput) body: StaffLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StaffMeResponse> {
    const meta = requestMeta(req);
    const { token, me } = await withRetryAfter(res, () =>
      this.staff.login({ ...body, ip: meta.ip, userAgent: meta.userAgent }),
    );
    setSessionCookie(res, STAFF_SESSION_COOKIE, token, undefined);
    return me;
  }

  @Post('logout')
  @StaffAccess()
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const actor = requireStaff();
    const tokenHash = cookieTokenHash(req, STAFF_SESSION_COOKIE);
    if (tokenHash !== undefined) await this.staff.logout(actor.sessionId, tokenHash);
    clearSessionCookie(res, STAFF_SESSION_COOKIE);
  }

  @Get('me')
  @StaffAccess()
  async me(): Promise<StaffMeResponse> {
    const me = await this.staff.me(requireStaff().staffId);
    if (me === null) throw unauthenticated('staff', 'staff_missing');
    return me;
  }
}
