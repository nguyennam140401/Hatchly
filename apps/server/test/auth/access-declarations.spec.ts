import { Controller, Get, Module } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { ApiAppModule } from '../../src/app/api-app.module';
import {
  AccessDeclarationError,
  scanAccessDeclarations,
} from '../../src/core/auth/access-declarations';
import { CustomerAccess, Public } from '../../src/core/auth/access.decorators';
import { loadConfig } from '../../src/core/config/load-config';
import { TEST_AUTH_ENV } from '../helpers/auth-env';

// T056 (FR-013, SC-004): mọi handler của API có ĐÚNG MỘT khai báo truy cập – chạy trong CI.

const config = loadConfig({
  APP_ENV: 'test',
  LOG_LEVEL: 'fatal',
  ...TEST_AUTH_ENV,
  DATABASE_APP_URL: 'postgres://app:x@127.0.0.1:1/app',
});

@Controller('x')
class MissingController {
  @Get('ok')
  @Public()
  ok(): string {
    return 'ok';
  }

  @Get('undeclared')
  undeclared(): string {
    return 'không';
  }
}
@Module({ controllers: [MissingController] })
class MissingModule {}

@Controller('y')
class DuplicateController {
  @Get('twice')
  @Public()
  @CustomerAccess()
  twice(): string {
    return 'không';
  }
}
@Module({ controllers: [DuplicateController] })
class DuplicateModule {}

// 009: `allowDetached` kèm quyền là khai báo vô nghĩa (người ở tài khoản chờ không có quyền nào).
@Controller('z')
class DetachedWithPermissionController {
  @Get('bad')
  @CustomerAccess({ allowDetached: true }, 'post.approve')
  bad(): string {
    return 'không';
  }

  @Get('good')
  @CustomerAccess({ allowDetached: true, allowUnverifiedEmail: true })
  good(): string {
    return 'ok';
  }
}
@Module({ controllers: [DetachedWithPermissionController] })
class DetachedWithPermissionModule {}

async function scan(extra: (new () => unknown)[] = []) {
  const moduleRef = await Test.createTestingModule({
    imports: [ApiAppModule.forRoot(config, { accessScan: 'log' }), ...extra],
  }).compile();
  try {
    return scanAccessDeclarations(moduleRef.get(DiscoveryService), moduleRef.get(MetadataScanner));
  } finally {
    await moduleRef.close();
  }
}

describe('Khai báo truy cập', () => {
  it('mọi handler của ApiAppModule có đúng một khai báo', async () => {
    const result = await scan();
    expect(result.missing).toEqual([]);
    expect(result.duplicated).toEqual([]);
    const names = result.handlers.map((h) => h.name);
    // Có duyệt thật các controller của lõi và của module account.
    expect(names).toEqual(
      expect.arrayContaining([
        'HealthController.health',
        'CustomerAuthController.login',
        'StaffAuthController.login',
      ]),
    );
  });

  it('handler thiếu khai báo → báo đúng tên', async () => {
    const result = await scan([MissingModule]);
    expect(result.missing).toEqual(['MissingController.undeclared']);
  });

  it('hai khai báo trên một handler → báo trùng', async () => {
    const result = await scan([DuplicateModule]);
    expect(result.duplicated).toEqual(['DuplicateController.twice']);
  });

  it('APP_ENV=test với accessScan mặc định → API không khởi động khi thiếu khai báo', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ApiAppModule.forRoot(config), MissingModule],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await expect(app.init()).rejects.toBeInstanceOf(AccessDeclarationError);
    await app.close().catch(() => undefined);
  });
  it('009: allowDetached kèm quyền → báo đúng tên, lỗi khởi động nêu lý do', async () => {
    const result = await scan([DetachedWithPermissionModule]);
    expect(result.invalid).toEqual(['DetachedWithPermissionController.bad']);
    expect(result.missing).toEqual([]);
    expect(new AccessDeclarationError(result).message).toContain(
      'allowDetached kèm quyền (người ở tài khoản chờ không có quyền nào): DetachedWithPermissionController.bad',
    );
    await expect(
      Test.createTestingModule({
        imports: [
          ApiAppModule.forRoot(config, { accessScan: 'throw' }),
          DetachedWithPermissionModule,
        ],
      })
        .compile()
        .then(async (m) => {
          const app = m.createNestApplication({ logger: false });
          try {
            await app.init();
          } finally {
            await app.close().catch(() => undefined);
          }
        }),
    ).rejects.toThrow(AccessDeclarationError);
  });

  it('009: ApiAppModule không có khai báo allowDetached kèm quyền', async () => {
    expect((await scan()).invalid).toEqual([]);
  });
});
