import type { INestApplication } from '@nestjs/common';
import type { AppConfig } from '../core';
import { requestContextMiddleware, resolveAuthConfig } from '../core';
import { originCheckMiddleware } from '../core/auth/origin-check.middleware';

interface ExpressLike {
  set(setting: string, value: unknown): unknown;
}

/**
 * Thiết lập dùng chung cho API thật và kiểm thử e2e: ngữ cảnh yêu cầu, proxy tin cậy, kiểm tra
 * nguồn gửi (CSRF – 004 R3, chạy trước guard), tiền tố, CORS.
 */
export function configureApiApp(app: INestApplication, config: AppConfig): void {
  const auth = resolveAuthConfig(config);
  // Địa chỉ mạng thật của khách (chống dò, dải mạng nội bộ): đúng số proxy tin cậy (R6).
  (app.getHttpAdapter().getInstance() as ExpressLike).set(
    'trust proxy',
    auth.trustProxyHops === 0 ? false : auth.trustProxyHops,
  );
  // Đặt trước mọi middleware khác để mọi phản hồi (kể cả 404) có x-trace-id.
  app.use(requestContextMiddleware);
  app.use(originCheckMiddleware(auth.webOrigins));
  app.setGlobalPrefix('api/v1', { exclude: ['healthz', 'readyz'] });
  app.enableCors({
    origin: config.CORS_ORIGINS,
    exposedHeaders: ['x-trace-id'],
    credentials: true,
  });
}
