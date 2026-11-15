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
  // 009 (research R19, FR-030): tham số giao thức đăng nhập nhà cung cấp, mã lời mời, thông báo Meta.
  // `code` và `state` CHỈ che ở tham số truy vấn của yêu cầu (`req.query.*` bên dưới): hai tên này quá
  // chung – che ở mọi nơi sẽ làm mất mã lỗi (`code: 'VALIDATION_FAILED'`) trong nhật ký vận hành.
  'signed_request',
  'code_verifier',
  'codeVerifier',
  'invitationToken',
  '*.signed_request',
  '*.code_verifier',
  '*.codeVerifier',
  '*.invitationToken',
  'req.query.code',
  'req.query.state',
];

/**
 * 009 (research R19): đường quay về của nhà cung cấp mang `code`, `state` trong chuỗi truy vấn. Với mọi
 * route dưới các tiền tố này, nhật ký yêu cầu ghi ĐƯỜNG DẪN (không chuỗi truy vấn, không `query`).
 * Lưu ý vận hành: nhật ký truy cập của ingress cũng phải bỏ chuỗi truy vấn cho các tiền tố này.
 */
export const QUERYLESS_LOG_PREFIXES: readonly string[] = [
  '/api/v1/auth/oauth/',
  '/api/v1/dev/oauth/',
];

/** Đường dẫn của URL, bỏ chuỗi truy vấn và mảnh. */
function pathOnly(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Bộ tuần tự hóa `req` của nhật ký yêu cầu: bỏ chuỗi truy vấn với các tiền tố nhạy cảm. */
export function serializeLoggedRequest<T extends { url?: unknown; query?: unknown }>(req: T): T {
  if (typeof req.url !== 'string') return req;
  const path = pathOnly(req.url);
  if (!QUERYLESS_LOG_PREFIXES.some((prefix) => path.startsWith(prefix))) return req;
  return { ...req, url: path, query: {} };
}

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
      serializers: { req: serializeLoggedRequest },
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
