import {
  type CallHandler,
  type ExecutionContext as NestExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { from, type Observable, catchError, concatMap, throwError } from 'rxjs';
import { getExecutionContext } from '../context/request-context';
import { readAccessDeclaration } from './access.decorators';
import { routeTemplate } from './access.guard';
import { clientIp, userAgentSummary } from './client-ip';
import { writeStaffRequestAudit } from './staff-audit';

// Mọi yêu cầu nội bộ THAY ĐỔI dữ liệu (@StaffAccess + POST/PUT/PATCH/DELETE) ghi `staff.request` vào
// infra.audit_log: phương thức, route mẫu, kết quả – KHÔNG ghi thân yêu cầu (FR-018, SC-008, R10).

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class StaffAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Auth');

  intercept(context: NestExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    if (!MUTATING.has(req.method)) return next.handle();
    let declaration;
    try {
      declaration = readAccessDeclaration(
        context.getHandler() as (...args: never[]) => unknown,
        context.getClass(),
      );
    } catch {
      return next.handle();
    }
    const actor = getExecutionContext()?.actor;
    if (declaration?.kind !== 'staff' || actor?.kind !== 'staff') return next.handle();

    const write = (result: 'ok' | 'error') =>
      writeStaffRequestAudit({
        staffId: actor.staffId,
        role: actor.role,
        ip: clientIp(req),
        uaFamily: userAgentSummary(req.headers['user-agent']),
        method: req.method,
        route: routeTemplate(req),
        result,
      }).catch((err: unknown) => {
        const code = (err as { code?: unknown } | null)?.code;
        this.logger.error({
          msg: 'audit.write_failed',
          event: 'audit.write_failed',
          action: 'staff.request',
          code: typeof code === 'string' ? code : 'UNKNOWN',
        });
      });

    return next.handle().pipe(
      concatMap((value: unknown) => from(write('ok').then(() => value))),
      catchError((err: unknown) =>
        from(write('error')).pipe(concatMap(() => throwError(() => err))),
      ),
    );
  }
}
