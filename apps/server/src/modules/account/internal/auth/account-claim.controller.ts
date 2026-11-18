import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { claimAccountRequest, type ClaimAccountRequest, type MeResponse } from '@app/shared/auth';
import type { Request, Response } from 'express';
import { CustomerAccess, requireCustomer, ValidBody } from '../../../../core';
import { CUSTOMER_SESSION_COOKIE, setSessionCookie } from '../../../../core/auth/cookies';
import { AccountClaimService } from './account-claim.service';
import { cookieTokenHash, requestMeta, secondsUntil } from './http';

// Người không thuộc tài khoản nào tự tạo tài khoản kinh doanh (009, contracts/auth-http-api.md mục 5).

@Controller('account')
export class AccountClaimController {
  constructor(@Inject(AccountClaimService) private readonly claims: AccountClaimService) {}

  @Post('claim')
  @CustomerAccess({ allowDetached: true })
  @HttpCode(200)
  async claim(
    // Chỉ để buộc `acceptTerms: true` – ô đồng ý không bao giờ được coi là đã tích sẵn.
    @ValidBody(claimAccountRequest) _body: ClaimAccountRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const result = await this.claims.claim(
      requireCustomer(),
      cookieTokenHash(req, CUSTOMER_SESSION_COOKIE),
      requestMeta(req),
    );
    setSessionCookie(
      res,
      CUSTOMER_SESSION_COOKIE,
      result.session.token,
      secondsUntil(result.session.absoluteExpiresAt),
    );
    return result.me;
  }
}
