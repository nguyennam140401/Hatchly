import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { UnitName } from '@app/shared/core';
import type { AppConfig } from '../config/config.schema';
import { ReadinessRegistry } from '../health/readiness';
import { createDatabase, DatabaseService, setActiveDatabase } from './database';
import { DbRoleInvalidError, type DbLogger } from './pools';

const logger = new Logger('Database');

const dbLogger: DbLogger = {
  warn: (entry) => {
    logger.warn({ msg: entry.event, ...entry });
  },
  error: (entry) => {
    logger.error({ msg: entry.event, ...entry });
  },
};

/** Vai trò CSDL sai (vd chạy nhầm bằng `owner`) → dừng tiến trình ngay (research R7). */
function failOnInvalidRole(err: unknown): void {
  if (err instanceof DbRoleInvalidError) {
    logger.fatal({ msg: 'db.role_invalid', event: 'db.role_invalid', role: err.roleName });
    process.exit(1);
  }
}

function codeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'UNKNOWN';
}

/** Tự kiểm vai trò khi khởi động; đóng bể sau khi ShutdownCoordinator chờ xong việc đang chạy. */
@Injectable()
class DatabaseLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  onApplicationBootstrap(): void {
    // Không chặn khởi động khi CSDL chưa sẵn sàng (/readyz báo 503); chỉ vai trò sai mới dừng.
    this.db.verifyRoles().catch((err: unknown) => {
      failOnInvalidRole(err);
      logger.warn({ msg: 'db.unavailable_at_startup', code: codeOf(err) });
    });
  }

  // onApplicationShutdown chạy SAU mọi beforeApplicationShutdown (ShutdownCoordinator đã chờ việc).
  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
  }
}

/** Lớp CSDL cho API/Worker: bể `app` (+ `system` ở Worker, `support` ở API), kiểm tra `/readyz`. */
@Global()
@Module({})
export class DatabaseModule {
  static forRoot(unit: UnitName, config: AppConfig): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DatabaseService,
          inject: [ReadinessRegistry],
          useFactory: (readiness: ReadinessRegistry) => {
            const db = createDatabase(config, unit, dbLogger);
            setActiveDatabase(db);
            readiness.register({
              name: 'database',
              check: async () => {
                try {
                  return await db.ping(2000);
                } catch (err) {
                  failOnInvalidRole(err);
                  return false;
                }
              },
            });
            return db;
          },
        },
        DatabaseLifecycle,
      ],
      exports: [DatabaseService],
    };
  }
}
