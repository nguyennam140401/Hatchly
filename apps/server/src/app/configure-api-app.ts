import type { INestApplication } from '@nestjs/common';
import type { AppConfig } from '../core';
import { requestContextMiddleware } from '../core';

/** Thiết lập dùng chung cho API thật và kiểm thử e2e: ngữ cảnh yêu cầu, tiền tố, CORS. */
export function configureApiApp(app: INestApplication, config: AppConfig): void {
  // Đặt trước mọi middleware khác để mọi phản hồi (kể cả 404) có x-trace-id.
  app.use(requestContextMiddleware);
  app.setGlobalPrefix('api/v1', { exclude: ['healthz', 'readyz'] });
  app.enableCors({ origin: config.CORS_ORIGINS, exposedHeaders: ['x-trace-id'] });
}
