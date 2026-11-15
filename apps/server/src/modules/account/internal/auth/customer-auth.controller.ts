import { Controller, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import {
  changeEmailInput,
  changePasswordInput,
  forgotPasswordInput,
  loginInput,
  registerInput,
  resendInput,
  resetPasswordInput,
  verifyEmailInput,
  type ChangeEmailInput,
  type ChangePasswordInput,
  type CheckEmailResponse,
  type ForgotPasswordInput,
  type LoginInput,
  type MeResponse,
  type RegisterInput,
  type ResendInput,
  type ResetPasswordInput,
  type VerifyEmailInput,
} from '@app/shared/auth';
import type { Request, Response } from 'express';
import {
  currentActor,
  CustomerAccess,
  Public,
  requireCustomer,
  tenantTx,
  ValidBody,
} from '../../../../core';
import {
  clearSessionCookie,
  CUSTOMER_SESSION_COOKIE,
  setSessionCookie,
} from '../../../../core/auth/cookies';
import { userAgentSummary } from '../../../../core/auth/client-ip';
import { writeAuthAudit } from './audit';
import { EmailVerificationService } from './email-verification.service';
import { cookieTokenHash, requestMeta, secondsUntil, withRetryAfter } from './http';
import { loadMe, loadMeInTx } from './me';
import { PasswordResetService } from './password-reset.service';
import { RegistrationService } from './registration.service';
import { SessionService, type IssuedSession } from './session.service';
import { unauthenticatedMe } from './unauthenticated';

// Điểm cuối xác thực của khách hàng (contracts/auth-http-api.md mục 1), tiền tố /api/v1/auth.
// Mọi điểm cuối có khai báo truy cập; thay đổi dữ liệu đã qua kiểm tra nguồn gửi (CSRF).

@Controller('auth')
export class CustomerAuthController {
  constructor(
    @Inject(RegistrationService) private readonly registration: RegistrationService,
    @Inject(EmailVerificationService) private readonly verification: EmailVerificationService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PasswordResetService) private readonly passwords: PasswordResetService,
  ) {}

  private setCookie(res: Response, session: IssuedSession): void {
    setSessionCookie(
      res,
      CUSTOMER_SESSION_COOKIE,
      session.token,
      secondsUntil(session.absoluteExpiresAt),
    );
  }

  // ----- US1: đăng ký, xác minh -----

  @Post('register')
  @Public()
  @HttpCode(202)
  register(
    @ValidBody(registerInput) body: RegisterInput,
    @Req() req: Request,
  ): Promise<CheckEmailResponse> {
    return this.registration.register(body, requestMeta(req));
  }

  @Post('email/verify')
  @Public()
  @HttpCode(200)
  async verifyEmail(
    @ValidBody(verifyEmailInput) body: VerifyEmailInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const actor = currentActor();
    const tokenHash = cookieTokenHash(req, CUSTOMER_SESSION_COOKIE);
    const current = actor?.kind === 'user' && tokenHash !== undefined ? { actor, tokenHash } : null;
    const { me, session } = await this.verification.verify(body.token, requestMeta(req), current);
    this.setCookie(res, session);
    return me;
  }

  @Post('email/resend')
  @Public()
  @HttpCode(202)
  resend(
    @ValidBody(resendInput) body: ResendInput,
    @Req() req: Request,
  ): Promise<CheckEmailResponse> {
    const actor = currentActor();
    return this.verification.resend(body, actor?.kind === 'user' ? actor : null, requestMeta(req));
  }

  @Patch('email')
  @CustomerAccess({ allowUnverifiedEmail: true, allowDetached: true })
  @HttpCode(202)
  changeEmail(
    @ValidBody(changeEmailInput) body: ChangeEmailInput,
    @Req() req: Request,
  ): Promise<CheckEmailResponse> {
    return this.verification.changeEmail(requireCustomer(), body.email, requestMeta(req));
  }

  // ----- US2: đăng nhập, phiên, đăng xuất -----

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @ValidBody(loginInput) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const { session, userId, accountId } = await withRetryAfter(res, () =>
      this.sessions.loginWithPassword({ ...body, meta: requestMeta(req) }),
    );
    this.setCookie(res, session);
    const me = await loadMe(accountId, userId);
    if (me === null) throw unauthenticatedMe();
    return me;
  }

  @Post('logout')
  @CustomerAccess({ allowUnverifiedEmail: true, allowDetached: true })
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const actor = requireCustomer();
    const tokenHash = cookieTokenHash(req, CUSTOMER_SESSION_COOKIE);
    await tenantTx((db) => this.sessions.revokeSession(db, actor.sessionId, 'logout', tokenHash));
    clearSessionCookie(res, CUSTOMER_SESSION_COOKIE);
  }

  @Post('logout-all')
  @CustomerAccess({ allowUnverifiedEmail: true, allowDetached: true })
  @HttpCode(204)
  async logoutAll(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const actor = requireCustomer();
    const meta = requestMeta(req);
    await tenantTx(async (db) => {
      await this.sessions.revokeAllForUser(db, actor.userId, 'logout_all');
      await writeAuthAudit(db, {
        actorType: 'user',
        actorId: actor.userId,
        accountId: actor.accountId,
        action: 'auth.logout_all',
        ip: meta.ip,
        uaFamily: userAgentSummary(meta.userAgent),
      });
    });
    clearSessionCookie(res, CUSTOMER_SESSION_COOKIE);
  }

  @Get('me')
  @CustomerAccess({ allowUnverifiedEmail: true, allowDetached: true })
  async me(): Promise<MeResponse> {
    const actor = requireCustomer();
    const me = await tenantTx((db) => loadMeInTx(db, actor.userId));
    if (me === null) throw unauthenticatedMe();
    return me;
  }

  // ----- US5: quên, đặt lại, đổi mật khẩu -----

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  forgot(
    @ValidBody(forgotPasswordInput) body: ForgotPasswordInput,
    @Req() req: Request,
  ): Promise<CheckEmailResponse> {
    return this.passwords.forgot(body.email, requestMeta(req));
  }

  @Post('password/reset')
  @Public()
  @HttpCode(200)
  async reset(
    @ValidBody(resetPasswordInput) body: ResetPasswordInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const { me, session } = await this.passwords.reset(
      body.token,
      body.newPassword,
      requestMeta(req),
    );
    this.setCookie(res, session);
    return me;
  }

  @Post('password/change')
  @CustomerAccess({ allowDetached: true })
  @HttpCode(204)
  async change(
    @ValidBody(changePasswordInput) body: ChangePasswordInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const actor = requireCustomer();
    const tokenHash = cookieTokenHash(req, CUSTOMER_SESSION_COOKIE);
    if (tokenHash === undefined) throw unauthenticatedMe();
    const session = await withRetryAfter(res, () =>
      this.passwords.change(
        actor,
        tokenHash,
        body.currentPassword,
        body.newPassword,
        requestMeta(req),
      ),
    );
    this.setCookie(res, session);
  }
}
