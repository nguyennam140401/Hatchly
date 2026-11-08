import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { UnitName } from '@app/shared/core';
import type { AppConfig } from '../config/config.schema';
import { getExecutionContext, resolveTraceId } from '../context/request-context';
import { currentAccountId } from '../db/transaction';

/** Đường dẫn bị che trong nhật ký – không bao giờ ghi bí mật (nguyên tắc VII). */
export const REDACT_PATHS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'connectionString',
  'databaseUrl',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.connectionString',
  'req.headers.authorization',
  'req.headers.cookie',
];

/**
 * Trường ngữ cảnh của mọi dòng nhật ký (FR-007): `account_id` lấy từ giao dịch CSDL hiện tại, nếu
 * không có thì từ ExecutionContext; `trace_id` từ ExecutionContext.
 */
export function logContextMixin(): { trace_id: string | null; account_id: string | null } {
  return { trace_id: getExecutionContext()?.traceId ?? null, account_id: currentAccountId() };
}

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
 * `account_id` (từ ngữ cảnh giao dịch CSDL / ExecutionContext – 002, FR-007).
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
            mixin: logContextMixin,
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
