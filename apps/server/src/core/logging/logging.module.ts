import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { UnitName } from '@app/shared/core';
import type { AppConfig } from '../config/config.schema';
import { getRequestContext, resolveTraceId } from '../context/request-context';

/** Đường dẫn bị che trong nhật ký – không bao giờ ghi bí mật (nguyên tắc VII). */
export const REDACT_PATHS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  'req.headers.authorization',
  'req.headers.cookie',
];

/** `pino-pretty` là phụ thuộc phát triển – ảnh container không có, khi đó vẫn ghi JSON. */
function hasPinoPretty(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Nhật ký JSON ra stdout (R7). Trường cố định: `unit`, `version`, `trace_id`,
 * `account_id` (để trống tới khi có phiên đăng nhập – WBS 2.1).
 */
@Module({})
export class LoggingModule {
  static forRoot(unit: UnitName, config: AppConfig): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.LOG_LEVEL,
            base: { unit, version: config.APP_VERSION },
            messageKey: 'msg',
            redact: { paths: REDACT_PATHS, censor: '[đã che]' },
            mixin: () => {
              const ctx = getRequestContext();
              return { trace_id: ctx?.traceId ?? null, account_id: ctx?.accountId ?? null };
            },
            genReqId: (req, res) => resolveTraceId(req, res),
            // Kiểm tra sống/sẵn sàng gọi liên tục – không ghi để nhật ký gọn.
            autoLogging: {
              ignore: (req) => req.url === '/healthz' || req.url === '/readyz',
            },
            ...(config.APP_ENV === 'development' && hasPinoPretty()
              ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
              : {}),
          },
        }),
      ],
      exports: [LoggerModule],
    };
  }
}
