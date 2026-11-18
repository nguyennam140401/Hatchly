import { Controller, Delete, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  loginMethodStartRequest,
  reauthRequest,
  type CheckEmailResponse,
  type LoginMethodsResponse,
  type LoginMethodStartRequest,
  type OAuthStartResponse,
  type ReauthRequest,
} from '@app/shared/auth';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CustomerAccess, requireCustomer, ValidBody, ValidParam } from '../../../../core';
import { notFound } from './errors';
import { requestMeta, withRetryAfter } from './http';
import { LoginMethodsService, METHOD_KINDS } from './login-methods.service';
import { providerOr404, setFlowCookie } from './oauth/oauth.controller';
import { OAuthLoginService } from './oauth/oauth-login.service';

// Cách đăng nhập của tôi (009, contracts/auth-http-api.md mục 2). Dùng được cho chủ, cộng tác viên và
// người ở tài khoản chờ (`allowDetached`); xem danh sách và xác nhận lại danh tính mở cả cho người
// chưa xác minh email.

const providerParam = z.object({ provider: z.string().max(40) });
const kindParam = z.object({ kind: z.string().max(40) });

@Controller('auth')
export class LoginMethodsController {
  constructor(
    @Inject(LoginMethodsService) private readonly methods: LoginMethodsService,
    @Inject(OAuthLoginService) private readonly oauth: OAuthLoginService,
  ) {}

  @Get('login-methods')
  @CustomerAccess({ allowUnverifiedEmail: true, allowDetached: true })
  list(): Promise<LoginMethodsResponse> {
    return this.methods.list(requireCustomer());
  }

  @Post('reauth')
  @CustomerAccess({ allowUnverifiedEmail: true, allowDetached: true })
  @HttpCode(204)
  async reauth(
    @ValidBody(reauthRequest) body: ReauthRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await withRetryAfter(res, () =>
      this.methods.reauthWithPassword(requireCustomer(), body.password, requestMeta(req)),
    );
  }

  // Khai báo TRƯỚC route có tham số `:provider/start` để "password/request" không bị nuốt.
  @Post('login-methods/password/request')
  @CustomerAccess({ allowDetached: true })
  @HttpCode(202)
  async requestPassword(): Promise<CheckEmailResponse> {
    await this.methods.requestPassword(requireCustomer());
    return { status: 'check_email' };
  }

  @Post('login-methods/:provider/start')
  @CustomerAccess({ allowDetached: true })
  @HttpCode(200)
  async start(
    @ValidParam(providerParam) params: z.infer<typeof providerParam>,
    @ValidBody(loginMethodStartRequest) body: LoginMethodStartRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OAuthStartResponse> {
    const started = await this.oauth.startForActor(
      requireCustomer(),
      providerOr404(params.provider),
      body.purpose,
      requestMeta(req),
    );
    setFlowCookie(res, started.flowToken);
    return { authorizationUrl: started.authorizationUrl };
  }

  @Delete('login-methods/:kind')
  @CustomerAccess({ allowDetached: true })
  @HttpCode(204)
  remove(
    @ValidParam(kindParam) params: z.infer<typeof kindParam>,
    @Req() req: Request,
  ): Promise<void> {
    const kind = METHOD_KINDS.find((k) => k === params.kind);
    if (kind === undefined) throw notFound();
    return this.methods.remove(requireCustomer(), kind, requestMeta(req));
  }
}
