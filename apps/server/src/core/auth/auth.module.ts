import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import {
  APP_GUARD,
  APP_INTERCEPTOR,
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
} from '@nestjs/core';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth-config';
import { AccessDeclarationError, scanAccessDeclarations } from './access-declarations';
import { AccessGuard } from './access.guard';
import { SessionCache } from './session-cache';
import { StaffAuditInterceptor } from './staff-audit.interceptor';

// Lõi xác thực của API (004): guard toàn cục mặc định từ chối, interceptor kiểm toán nhân viên, bộ
// nhớ đệm phiên, kiểm tra khai báo truy cập khi khởi động. CHỈ nhập ở ApiAppModule (Worker không có
// HTTP). Kiểm tra nguồn gửi (CSRF) là middleware Express gắn ở configureApiApp, chạy trước guard.

/** `throw`: thiếu/trùng khai báo → API không khởi động; `log`: ghi `error`, guard vẫn từ chối. */
export type AccessScanMode = 'throw' | 'log';
export const ACCESS_SCAN_MODE = Symbol('ACCESS_SCAN_MODE');

@Injectable()
class AccessDeclarationCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
    @Inject(ACCESS_SCAN_MODE) private readonly mode: AccessScanMode,
  ) {}

  onApplicationBootstrap(): void {
    const scan = scanAccessDeclarations(this.discovery, this.scanner);
    if (scan.missing.length === 0 && scan.duplicated.length === 0) return;
    if (this.mode === 'throw') throw new AccessDeclarationError(scan);
    this.logger.error({
      msg: 'auth.access_not_declared',
      event: 'auth.access_not_declared',
      missing: scan.missing,
      duplicated: scan.duplicated,
    });
  }
}

@Global()
@Module({})
export class AuthModule {
  static forRoot(
    config: AuthConfig,
    options: { accessScan?: AccessScanMode | undefined } = {},
  ): DynamicModule {
    const mode: AccessScanMode =
      options.accessScan ??
      (config.appEnv === 'development' || config.appEnv === 'test' ? 'throw' : 'log');
    return {
      module: AuthModule,
      imports: [DiscoveryModule],
      providers: [
        { provide: AUTH_CONFIG, useValue: config },
        { provide: ACCESS_SCAN_MODE, useValue: mode },
        SessionCache,
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_INTERCEPTOR, useClass: StaffAuditInterceptor },
        AccessDeclarationCheck,
      ],
      exports: [AUTH_CONFIG, SessionCache],
    };
  }
}
