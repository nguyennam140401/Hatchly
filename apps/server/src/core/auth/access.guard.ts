import {
  type CanActivate,
  type ExecutionContext as NestExecutionContext,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth-config';
import type { CustomerActor, StaffActor } from '../context/actor.types';
import { bindAccountToRequest, bindActorToRequest } from '../context/bind-account';
import { getExecutionContext } from '../context/request-context';
import { readAccessDeclaration, type AccessDeclaration } from './access.decorators';
import {
  accessNotDeclared,
  authUnavailable,
  emailNotVerified,
  forbidden,
  ipNotAllowed,
  noAccount,
  unauthenticated,
} from './auth-errors';
import { cidrMatcher, clientIp, userAgentSummary } from './client-ip';
import {
  clearSessionCookie,
  CUSTOMER_SESSION_COOKIE,
  hashToken,
  readCookie,
  STAFF_SESSION_COOKIE,
} from './cookies';
import { roleHasPermission, type Permission } from './permissions';
import { SessionCache } from './session-cache';
import { SESSION_RESOLVER, type SessionResolver } from './session-resolver';
import { writeStaffRequestAudit } from './staff-audit';

// Lớp chặn quyền toàn cục, MẶC ĐỊNH TỪ CHỐI (FR-012, FR-013, R7, contracts/authz-api.md mục 6).
// Thứ tự: khai báo → (Public: cho qua) → cookie đúng loại → bộ nhớ đệm/SessionResolver → gắn người
// gọi + tài khoản → người ở tài khoản chờ (009: NO_ACCOUNT trừ khi allowDetached) → email đã xác nhận
// → quyền → (nhân viên) dải mạng.
// Guard KHÔNG đọc path/query/body: mã tài khoản chỉ đến từ phiên đã tra trong CSDL (nguyên tắc I).
// Đây là nơi DUY NHẤT gọi `bindAccountToRequest` (quy tắc ranh giới `bind-account-restricted`).

@Injectable()
export class AccessGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger('Auth');
  private resolver: SessionResolver | undefined;
  private readonly staffIpAllowed: (ip: string) => boolean;

  constructor(
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(SessionCache) private readonly cache: SessionCache,
  ) {
    this.staffIpAllowed = cidrMatcher(config.staffAllowedCidrs);
  }

  /** Thiếu nhà cung cấp SESSION_RESOLVER (AccountModule) → ném lỗi, API không khởi động. */
  onModuleInit(): void {
    this.resolver = this.moduleRef.get<SessionResolver>(SESSION_RESOLVER, { strict: false });
  }

  async canActivate(context: NestExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return false;
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const handler = context.getHandler() as (...args: never[]) => unknown;
    const controller = context.getClass() as abstract new (...args: never[]) => unknown;

    let declaration: AccessDeclaration | null;
    try {
      declaration = readAccessDeclaration(handler, controller);
    } catch {
      declaration = null;
    }
    if (declaration === null) {
      this.logger.error({
        msg: 'auth.access_not_declared',
        event: 'auth.access_not_declared',
        handler: `${controller.name}.${handler.name}`,
        trace_id: getExecutionContext()?.traceId ?? null,
      });
      throw accessNotDeclared();
    }

    switch (declaration.kind) {
      case 'public':
        await this.attachOptionalCustomer(req);
        return true;
      case 'customer':
        await this.authorizeCustomer(req, res, declaration);
        return true;
      case 'staff':
        await this.authorizeStaff(req, res, declaration.permissions);
        return true;
    }
  }

  private requireResolver(): SessionResolver {
    if (this.resolver === undefined) throw authUnavailable('SESSION_RESOLVER_MISSING');
    return this.resolver;
  }

  private async lookupCustomer(tokenHash: Buffer): Promise<CustomerActor | null> {
    const cached = this.cache.get(tokenHash);
    if (cached !== undefined) return cached.kind === 'user' ? cached : null;
    const resolved = await this.requireResolver().resolveCustomer(tokenHash);
    if (resolved === null) return null;
    this.cache.set(tokenHash, resolved.actor, resolved.absoluteExpiresAt);
    return resolved.actor;
  }

  private async lookupStaff(tokenHash: Buffer, ip: string): Promise<StaffActor | null> {
    const cached = this.cache.get(tokenHash);
    if (cached !== undefined) return cached.kind === 'staff' ? cached : null;
    const resolved = await this.requireResolver().resolveStaff(tokenHash, ip);
    if (resolved === null) return null;
    this.cache.set(tokenHash, resolved.actor, resolved.absoluteExpiresAt);
    return resolved.actor;
  }

  /** Lỗi khi tra phiên → 503 (không bao giờ cho qua). */
  private async safely<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AppError) throw err;
      const code = (err as { code?: unknown } | null)?.code;
      this.logger.error({
        msg: 'auth.session_lookup_failed',
        event: 'auth.session_lookup_failed',
        code: typeof code === 'string' ? code : 'UNKNOWN',
        trace_id: getExecutionContext()?.traceId ?? null,
      });
      throw authUnavailable(typeof code === 'string' ? code : 'SESSION_LOOKUP_FAILED');
    }
  }

  /** @Public: có cookie khách hàng hợp lệ thì gắn người gọi (KHÔNG gắn tài khoản). */
  private async attachOptionalCustomer(req: Request): Promise<void> {
    const token = readCookie(req, CUSTOMER_SESSION_COOKIE);
    if (token === undefined) return;
    try {
      const actor = await this.lookupCustomer(hashToken(token));
      if (actor !== null) bindActorToRequest(actor);
    } catch {
      // Điểm cuối công khai không phụ thuộc phiên – lỗi tra phiên thì coi như chưa đăng nhập.
    }
  }

  private async authorizeCustomer(
    req: Request,
    res: Response,
    declaration: Extract<AccessDeclaration, { kind: 'customer' }>,
  ): Promise<void> {
    // Chỉ đọc cookie khách hàng – cookie nhân viên không có giá trị ở đây (→ 401).
    const token = readCookie(req, CUSTOMER_SESSION_COOKIE);
    if (token === undefined) throw unauthenticated('customer', 'no_session');
    const actor = await this.safely(() => this.lookupCustomer(hashToken(token)));
    if (actor === null) {
      clearSessionCookie(res, CUSTOMER_SESSION_COOKIE);
      // Phiên có cookie nhưng không còn hiệu lực: hết hạn/thu hồi (lý do chi tiết cần tra CSDL – xem ghi chú 011).
      throw unauthenticated('customer', 'session_invalid', 'expired');
    }
    bindActorToRequest(actor);
    bindAccountToRequest(actor.accountId);

    // 009 (research R7): mặc định từ chối người không thuộc tài khoản nào – mọi điểm cuối nghiệp vụ
    // sẵn có tự động bị chặn mà không phải sửa.
    if (actor.detached && !declaration.allowDetached) {
      this.logger.warn({
        msg: 'auth.denied',
        event: 'auth.denied',
        trace_id: getExecutionContext()?.traceId ?? null,
        actor_id: actor.userId,
        account_id: actor.accountId,
        required: declaration.permissions,
        reason: 'detached',
      });
      throw noAccount();
    }
    if (!declaration.allowUnverifiedEmail && !actor.emailVerified) throw emailNotVerified();
    // Người ở tài khoản chờ không có quyền nào (kể cả khi khai báo sai lọt qua kiểm tra khởi động).
    const missing = declaration.permissions.find(
      (p) => actor.detached || !roleHasPermission(actor.role, p),
    );
    if (missing !== undefined) {
      this.logDenied(actor.userId, actor.accountId, declaration.permissions, missing);
      throw forbidden(missing, actor.role);
    }
  }

  private async authorizeStaff(
    req: Request,
    res: Response,
    permissions: Permission[],
  ): Promise<void> {
    // Chỉ đọc cookie nhân viên – cookie khách hàng không có giá trị ở lối vào nội bộ (→ 401).
    const token = readCookie(req, STAFF_SESSION_COOKIE);
    if (token === undefined) throw unauthenticated('staff', 'no_session');
    const ip = clientIp(req);
    const actor = await this.safely(() => this.lookupStaff(hashToken(token), ip));
    if (actor === null) {
      clearSessionCookie(res, STAFF_SESSION_COOKIE);
      throw unauthenticated('staff', 'session_invalid');
    }
    bindActorToRequest(actor);

    const audit = (result: string) =>
      this.safely(() =>
        writeStaffRequestAudit({
          staffId: actor.staffId,
          role: actor.role,
          ip,
          uaFamily: userAgentSummary(req.headers['user-agent']),
          method: req.method,
          route: routeTemplate(req),
          result,
        }),
      );

    if (!this.staffIpAllowed(ip)) {
      await audit('denied_ip');
      throw ipNotAllowed();
    }
    const missing = permissions.find((p) => !roleHasPermission(actor.role, p));
    if (missing !== undefined) {
      this.logDenied(actor.staffId, null, permissions, missing);
      await audit('forbidden');
      throw forbidden(missing, actor.role);
    }
  }

  private logDenied(
    actorId: string,
    accountId: string | null,
    required: Permission[],
    missing: Permission,
  ): void {
    this.logger.warn({
      msg: 'auth.denied',
      event: 'auth.denied',
      trace_id: getExecutionContext()?.traceId ?? null,
      actor_id: actorId,
      account_id: accountId,
      required,
      reason: `missing_permission:${missing}`,
    });
  }
}

/** Route mẫu của Express (vd `/api/v1/x/:id`) – không chứa giá trị tham số. */
export function routeTemplate(req: Request): string {
  const route = (req.route as { path?: unknown } | undefined)?.path;
  const base = req.baseUrl;
  return typeof route === 'string' ? `${base}${route}` : base || '(không rõ)';
}
