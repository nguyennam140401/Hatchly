import { Controller, Get, Inject } from '@nestjs/common';
import { ERROR_CODES, type HealthResponse, type ReadinessResponse } from '@app/shared/core';
import { APP_CONFIG, type AppConfig } from '../config/config.schema';
import { AppError } from '../errors/app-error';
import { ShutdownCoordinator } from '../lifecycle/shutdown-coordinator';
import { ReadinessRegistry } from './readiness';

// Lưu ý: luôn dùng @Inject(...) tường minh – `tsx` (esbuild) dùng khi phát triển không sinh
// decorator metadata nên NestJS không suy ra được kiểu tham số hàm dựng.

/** Kiểm tra sống / sẵn sàng của API – không cần đăng nhập, không chứa dữ liệu tenant (FR-003). */
@Controller()
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ShutdownCoordinator) private readonly coordinator: ShutdownCoordinator,
    @Inject(ReadinessRegistry) private readonly readiness: ReadinessRegistry,
  ) {}

  @Get('healthz')
  health(): HealthResponse {
    return {
      status: 'ok',
      unit: 'api',
      version: this.config.APP_VERSION,
      time: new Date().toISOString(),
    };
  }

  @Get('readyz')
  async ready(): Promise<ReadinessResponse> {
    const state = this.coordinator.state;
    if (state === 'stopping' || state === 'stopped') {
      throw unavailable('stopping');
    }
    const checks = await this.readiness.run();
    const failed = checks.filter((c) => c.status === 'fail');
    if (failed.length > 0) {
      throw unavailable(`checks_failed:${failed.map((c) => c.name).join(',')}`);
    }
    return { status: 'ready', checks };
  }
}

function unavailable(detail: string): AppError {
  return new AppError({
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    httpStatus: 503,
    message: 'Hệ thống đang tạm dừng để cập nhật. Vui lòng thử lại sau ít phút.',
    actions: [{ kind: 'retry', label: 'Thử lại' }],
    detail,
  });
}
