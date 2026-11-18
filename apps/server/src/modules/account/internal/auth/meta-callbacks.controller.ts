import { Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { DataDeletionStatusResponse } from '@app/shared/auth';
import type { Request } from 'express';
import { z } from 'zod';
import { Public, ValidParam } from '../../../../core';
import { MetaCallbacksService } from './meta-callbacks.service';

// Thông báo của Meta (009, FR-009a, contracts/auth-http-api.md mục 6). Hai điểm cuối POST là máy gọi
// máy: không có Origin/cookie nên được miễn kiểm tra nguồn gửi bằng danh sách CỐ ĐỊNH trong
// core/auth/origin-check.middleware.ts; tính xác thực dựa hoàn toàn vào chữ ký `signed_request`.
// Thân `application/x-www-form-urlencoded` do bộ đọc mặc định của NestJS/Express xử lý.

const codeParam = z.object({ code: z.string().min(1).max(64) });

/** Lấy `signed_request` từ thân đã được đọc; không có → undefined (dịch vụ trả 400). */
function signedRequestOf(req: Request): unknown {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null) return undefined;
  return (body as Record<string, unknown>).signed_request;
}

@Controller()
export class MetaCallbacksController {
  constructor(@Inject(MetaCallbacksService) private readonly meta: MetaCallbacksService) {}

  @Post('auth/facebook/deauthorize')
  @Public()
  @HttpCode(200)
  async deauthorize(@Req() req: Request): Promise<Record<string, never>> {
    const { userId } = this.meta.verify(signedRequestOf(req));
    await this.meta.handle('deauthorize', userId);
    return {};
  }

  @Post('auth/facebook/data-deletion')
  @Public()
  @HttpCode(200)
  async dataDeletion(@Req() req: Request): Promise<{ url: string; confirmation_code: string }> {
    const { userId } = this.meta.verify(signedRequestOf(req));
    const { code } = await this.meta.handle('data_deletion', userId);
    return { url: this.meta.statusUrl(code), confirmation_code: code };
  }

  @Get('public/data-deletion/:code')
  @Public()
  status(
    @ValidParam(codeParam) params: z.infer<typeof codeParam>,
  ): Promise<DataDeletionStatusResponse> {
    return this.meta.status(params.code);
  }
}
