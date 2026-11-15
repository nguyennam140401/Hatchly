import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  oauthConfirmRequest,
  oauthLinkPasswordRequest,
  oauthSignupRequest,
  oauthStartRequest,
  type CheckEmailResponse,
  type MeResponse,
  type OAuthConfirmRequest,
  type OAuthLinkPasswordRequest,
  type OAuthPendingResponse,
  type OAuthSignupRequest,
  type OAuthStartRequest,
  type OAuthStartResponse,
} from '@app/shared/auth';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  AUTH_CONFIG,
  currentActor,
  Public,
  ValidBody,
  ValidParam,
  ValidQuery,
  type AuthConfig,
} from '../../../../../core';
import {
  clearSessionCookie,
  CUSTOMER_SESSION_COOKIE,
  OAUTH_FLOW_COOKIE,
  OAUTH_FLOW_COOKIE_MAX_AGE_SECONDS,
  readCookie,
  setSessionCookie,
} from '../../../../../core/auth/cookies';
import { notFound } from '../errors';
import { requestMeta, secondsUntil, withRetryAfter } from '../http';
import type { IssuedSession } from '../session.service';
import { isProviderName, type ProviderName } from './identity-provider';
import { OAuthLoginService } from './oauth-login.service';

// Đăng nhập qua Google/Facebook (009, contracts/auth-http-api.md mục 1), tiền tố /api/v1/auth/oauth.
// Mọi điểm cuối là @Public; lượt gắn trình duyệt bằng cookie `__Host-oauth`. Đường quay về LUÔN 303
// về `{WEB}/oauth/result` KHÔNG tham số – kết quả đọc bằng `GET pending`. Nhật ký yêu cầu của tiền tố
// này không ghi chuỗi truy vấn (core/logging).

const providerParam = z.object({ provider: z.string().max(40) });
/** Tham số nhà cung cấp gửi về – đều tùy chọn và có giới hạn độ dài; không tin nội dung. */
const callbackQuery = z.object({
  code: z.string().max(4096).optional(),
  state: z.string().max(512).optional(),
  error: z.string().max(200).optional(),
});

/** `{provider}` ngoài google | facebook → 404. */
export function providerOr404(value: string): ProviderName {
  if (!isProviderName(value)) throw notFound();
  return value;
}

export function setFlowCookie(res: Response, flowToken: string): void {
  setSessionCookie(res, OAUTH_FLOW_COOKIE, flowToken, OAUTH_FLOW_COOKIE_MAX_AGE_SECONDS);
}

@Controller('auth/oauth')
export class OAuthController {
  constructor(
    @Inject(OAuthLoginService) private readonly oauth: OAuthLoginService,
    @Inject(AUTH_CONFIG) private readonly auth: AuthConfig,
  ) {}

  private setSession(res: Response, session: IssuedSession): void {
    setSessionCookie(
      res,
      CUSTOMER_SESSION_COOKIE,
      session.token,
      secondsUntil(session.absoluteExpiresAt),
    );
  }

  private customer() {
    const actor = currentActor();
    return actor?.kind === 'user' ? actor : null;
  }

  @Post(':provider/start')
  @Public()
  @HttpCode(200)
  async start(
    @ValidParam(providerParam) params: z.infer<typeof providerParam>,
    @ValidBody(oauthStartRequest) body: OAuthStartRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OAuthStartResponse> {
    const provider = providerOr404(params.provider);
    const meta = requestMeta(req);
    const started =
      body.purpose === 'login'
        ? await this.oauth.startLogin(provider, meta)
        : await this.oauth.startInvite(provider, body.invitationToken, this.customer(), meta);
    setFlowCookie(res, started.flowToken);
    return { authorizationUrl: started.authorizationUrl };
  }

  @Get(':provider/callback')
  @Public()
  async callback(
    @ValidParam(providerParam) params: z.infer<typeof providerParam>,
    @ValidQuery(callbackQuery) query: z.infer<typeof callbackQuery>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const provider = providerOr404(params.provider);
    const { session } = await this.oauth.handleCallback({
      provider,
      code: query.code,
      state: query.state,
      error: query.error,
      flowToken: readCookie(req, OAUTH_FLOW_COOKIE),
      actor: this.customer(),
      meta: requestMeta(req),
    });
    if (session !== null) this.setSession(res, session);
    // Không tham số: không có gì của lượt lọt vào lịch sử trình duyệt hay nhật ký.
    res.redirect(303, `${this.auth.webBaseUrl}/oauth/result`);
  }

  @Get('pending')
  @Public()
  async pending(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OAuthPendingResponse> {
    const { body, finished } = await this.oauth.pending(readCookie(req, OAUTH_FLOW_COOKIE));
    if (finished) clearSessionCookie(res, OAUTH_FLOW_COOKIE);
    return body;
  }

  @Post('signup')
  @Public()
  async signup(
    @ValidBody(oauthSignupRequest) body: OAuthSignupRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse | CheckEmailResponse> {
    const outcome = await this.oauth.signup(
      readCookie(req, OAUTH_FLOW_COOKIE),
      body,
      requestMeta(req),
    );
    if (outcome.kind === 'check_email') {
      res.status(202);
      return { status: 'check_email' };
    }
    res.status(200);
    this.setSession(res, outcome.result.session);
    clearSessionCookie(res, OAUTH_FLOW_COOKIE);
    return outcome.result.me;
  }

  @Post('link/password')
  @Public()
  @HttpCode(200)
  async linkPassword(
    @ValidBody(oauthLinkPasswordRequest) body: OAuthLinkPasswordRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const result = await withRetryAfter(res, () =>
      this.oauth.linkWithPassword(
        readCookie(req, OAUTH_FLOW_COOKIE),
        body.password,
        requestMeta(req),
      ),
    );
    this.setSession(res, result.session);
    clearSessionCookie(res, OAUTH_FLOW_COOKIE);
    return result.me;
  }

  @Post('link/send-email')
  @Public()
  @HttpCode(202)
  async linkSendEmail(@Req() req: Request): Promise<CheckEmailResponse> {
    await this.oauth.sendLinkEmail(readCookie(req, OAUTH_FLOW_COOKIE));
    return { status: 'check_email' };
  }

  @Post('confirm')
  @Public()
  @HttpCode(200)
  async confirm(
    @ValidBody(oauthConfirmRequest) body: OAuthConfirmRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const result = await this.oauth.confirm(body.token, requestMeta(req));
    this.setSession(res, result.session);
    return result.me;
  }
}
