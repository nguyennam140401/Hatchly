// Thể hiện pg-boss chỉ-tạo-việc của API (research R4): bể riêng vai trò `app` (QUEUE_API_POOL_MAX), chỉ
// đọc bộ nhớ đệm cấu hình hàng chờ; lệnh ghi đi qua kết nối của giao dịch.
import type { Pool } from 'pg';
import type { QueueLogger } from './logger';
import {
  assertSchemaVersion,
  createProducerBoss,
  createQueuePool,
  type PgBoss,
} from './pgboss/boss-loader';
import { clearProducer, setProducer } from './producer';

export interface ProducerHandle {
  boss: PgBoss;
  pool: Pool;
  stop(): Promise<void>;
}

export async function startProducer(options: {
  appUrl: string;
  poolMax: number;
  logger: QueueLogger;
  applicationName?: string;
}): Promise<ProducerHandle> {
  const pool = createQueuePool({
    url: options.appUrl,
    max: options.poolMax,
    applicationName: options.applicationName ?? 'api-queue',
    onError: (code) => {
      options.logger.warn({ event: 'queue.pool_error', pool: 'producer', code });
    },
  });
  try {
    await assertSchemaVersion(pool);
    const boss = await createProducerBoss(pool);
    boss.on('error', (err: unknown) => {
      const code = (err as { code?: unknown } | null)?.code;
      options.logger.warn({
        event: 'queue.boss_error',
        code: typeof code === 'string' ? code : 'UNKNOWN',
      });
    });
    await boss.start();
    setProducer(boss);
    return {
      boss,
      pool,
      stop: async () => {
        clearProducer(boss);
        await boss.stop({ graceful: false, close: false });
        await pool.end();
      },
    };
  } catch (err) {
    await pool.end().catch(() => undefined);
    throw err;
  }
}
