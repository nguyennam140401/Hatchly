import type { IncomingMessage, ServerResponse } from 'node:http';
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
  // 004 (R13): cookie phiên, mật khẩu và mã một lần trong thân yêu cầu.
  'currentPassword',
  'newPassword',
  '*.currentPassword',
  '*.newPassword',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

/**
 * Trường ngữ cảnh của mọi dòng nhật ký (FR-007): `account_id` lấy từ giao dịch CSDL hiện tại, nếu
 * không có thì từ ExecutionContext; `trace_id` từ ExecutionContext; `actor_id`, `actor_kind` từ người
 * gọi đã xác thực (004).
 */
export function logContextMixin(): {
  trace_id: string | null;
  account_id: string | null;
  actor_id: string | null;
  actor_kind: 'user' | 'staff' | null;
} {
  const ctx = getExecutionContext();
  const actor = ctx?.actor;
  return {
    trace_id: ctx?.traceId ?? null,
    account_id: currentAccountId(),
    actor_id: actor === undefined ? null : actor.kind === 'user' ? actor.userId : actor.staffId,
    actor_kind: actor?.kind ?? null,
  };
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
/** Đích ghi nhật ký tùy chọn (kiểm thử bắt mọi dòng – 004 SC-007). */
export interface LogDestination {
  write(chunk: string): unknown;
}

@Module({})
export class LoggingModule {
  static forRoot(unit: UnitName, config: AppConfig, destination?: LogDestination): DynamicModule {
    const options = {
      level: config.LOG_LEVEL,
      base: { unit, version: config.APP_VERSION },
      messageKey: 'msg',
      redact: { paths: REDACT_PATHS, censor: '[đã che]' },
      mixin: logContextMixin,
      genReqId: (req: IncomingMessage, res: ServerResponse) => resolveTraceId(req, res),
      // Kiểm tra sống/sẵn sàng gọi liên tục – không ghi để nhật ký gọn.
      autoLogging: {
        ignore: (req: IncomingMessage) => req.url === '/healthz' || req.url === '/readyz',
      },
      ...(config.APP_ENV === 'development' && hasPinoPretty() && destination === undefined
        ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
        : {}),
    };
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: destination === undefined ? options : [options, destination],
        }),
      ],
      exports: [LoggerModule],
    };
  }
}
