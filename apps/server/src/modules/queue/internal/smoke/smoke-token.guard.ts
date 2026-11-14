// Bộ gác điểm cuối kiểm tra khói (008 FR-032, contracts/deploy-pipeline.md): so mã trong tiêu đề
// `X-Smoke-Token` với `SMOKE_TOKEN`. Thiếu tiêu đề, sai mã HOẶC chưa cấu hình mã → 404 giống hệt đường dẫn
// không tồn tại (không lộ việc có điểm cuối này).
import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../../../core';

/** So sánh hằng thời gian; độ dài khác nhau → false (băm không cần: độ dài mã không phải bí mật). */
export function tokensMatch(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class SmokeTokenGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.SMOKE_TOKEN;
    const header = context.switchToHttp().getRequest<Request>().headers['x-smoke-token'];
    const given = Array.isArray(header) ? header[0] : header;
    if (expected === undefined || given === undefined || !tokensMatch(expected, given)) {
      throw new NotFoundException();
    }
    return true;
  }
}
