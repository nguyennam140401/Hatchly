// 008 T068 – kiểm tra khói: dòng infra.smoke_pings và việc queue.smoke_ping nằm CÙNG một giao dịch;
// bộ xử lý chạy lại hai lần cho cùng kết quả; dòng cũ hơn 7 ngày bị dọn (FR-032, hiến pháp V).
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { authTx } from '../../src/core/db/auth-tx';
import { enqueue } from '../../src/modules/queue';
import { cleanupJob } from '../../src/modules/queue/jobs';
import { smokePings } from '../../src/modules/queue/internal/db/schema';
import { registerInternalHandlers, runCleanup } from '../../src/modules/queue/internal/maintenance';
import { smokePingJob } from '../../src/modules/queue/jobs';
import { expectIdempotent, startTestProducer } from '../support/queue-test-kit';
import {
  asOwner,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  type TestDatabase,
} from './helpers/queue-db';

interface PingRow {
  id: string;
  api_version: string;
  processed_at: Date | null;
  worker_version: string | null;
}
const pings = () =>
  asOwner(
    async (c) =>
      (
        await c.query<PingRow>(
          'SELECT id::text, api_version, processed_at, worker_version FROM infra.smoke_pings ORDER BY requested_at',
        )
      ).rows,
  );

describeDb('Kiểm tra khói – smoke_pings + queue.smoke_ping', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  const originalVersion = process.env.APP_VERSION;

  beforeAll(async () => {
    database = makeDatabase();
    stopProducer = await startTestProducer();
    registerInternalHandlers();
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
    if (originalVersion === undefined) delete process.env.APP_VERSION;
    else process.env.APP_VERSION = originalVersion;
  });
  beforeEach(async () => {
    await resetQueues();
    await asOwner((c) => c.query('DELETE FROM infra.smoke_pings'));
  });
  afterEach(() => {
    delete process.env.APP_VERSION;
  });

  const insertAndEnqueue = (id: string, failAfter = false) =>
    authTx(async (db) => {
      await db.insert(smokePings).values({ id, requested_at: new Date(), api_version: 'api-v1' });
      await enqueue(smokePingJob, { pingId: id });
      if (failAfter) throw new Error('hoàn tác');
    });

  it('giao dịch hủy → không có cả dòng lẫn việc; giao dịch xong → có cả hai', async () => {
    await expect(insertAndEnqueue(randomUUID(), true)).rejects.toThrow('hoàn tác');
    expect(await pings()).toHaveLength(0);
    expect(await jobs('name = $1', ['notify'])).toHaveLength(0);

    const id = randomUUID();
    await insertAndEnqueue(id);
    expect((await pings()).map((p) => p.id)).toEqual([id]);
    const queued = await jobs('name = $1', ['notify']);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.data).toMatchObject({
      type: 'queue.smoke_ping',
      accountId: null,
      payload: { pingId: id },
    });
  });

  it('vai app chỉ tạo được ĐÚNG việc queue.smoke_ping; việc hệ thống loại khác bị RLS từ chối', async () => {
    await expect(authTx(() => enqueue(cleanupJob, {}))).rejects.toThrow();
    expect(await jobs()).toHaveLength(0);
  });

  it('bộ xử lý chạy hai lần → cùng kết quả, worker_version không bị ghi đè', async () => {
    const id = randomUUID();
    await insertAndEnqueue(id);
    process.env.APP_VERSION = 'worker-v1';
    await expectIdempotent(
      smokePingJob,
      { pingId: id },
      {
        snapshot: async () => {
          // Lần chạy thứ hai mang phiên bản khác: phải bị bỏ qua vì dòng đã được đánh dấu.
          process.env.APP_VERSION = 'worker-v2';
          return (await pings()).map((p) => ({
            ...p,
            processed_at: p.processed_at?.toISOString(),
          }));
        },
      },
    );
    const [row] = await pings();
    expect(row).toMatchObject({ id, api_version: 'api-v1', worker_version: 'worker-v1' });
    expect(row!.processed_at).not.toBeNull();
  });

  it('dọn dẹp xóa dòng cũ hơn 7 ngày, giữ dòng mới hơn', async () => {
    const oldId = randomUUID();
    const freshId = randomUUID();
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO infra.smoke_pings (id, requested_at, api_version) VALUES
           ($1, now() - interval '8 days', 'api-v1'), ($2, now() - interval '6 days', 'api-v1')`,
        [oldId, freshId],
      );
    });
    const result = await runCleanup();
    expect(result.smokePings).toBe(1);
    expect((await pings()).map((p) => p.id)).toEqual([freshId]);
  });
});
