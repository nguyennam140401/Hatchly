// 003 T035 – FR-019, R16: /readyz của Worker phản ánh trạng thái hàng chờ; mất CSDL → 503 trong ≤ 30 giây,
// tiến trình không thoát; khôi phục → 200; phiên bản schema lệch → 503 + queue.schema_version_mismatch.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WorkerHealthServer } from '../../src/core/health/worker-health-server';
import { ReadinessRegistry } from '../../src/core/health/readiness';
import { queueReadinessCheck } from '../../src/modules/queue/internal/readiness';
import { startTestWorkers, type TestWorkers } from '../support/queue-test-kit';
import { asAdmin, asOwner, describeDb, makeDatabase, waitFor, type TestDatabase } from './helpers/queue-db';

describeDb('Worker /readyz – kiểm tra queue', () => {
  let database: TestDatabase;
  let workers: TestWorkers;
  let server: WorkerHealthServer;

  beforeAll(async () => {
    database = makeDatabase();
    workers = await startTestWorkers(1, { queues: ['notify'] });
    const registry = new ReadinessRegistry();
    registry.register(queueReadinessCheck(() => workers.runtimes[0]));
    server = new WorkerHealthServer({ version: 't', getState: () => 'ready', readiness: registry });
    await server.listen(0);
  });
  afterAll(async () => {
    await asAdmin((c) => c.query('ALTER ROLE "system" CONNECTION LIMIT -1'));
    await asOwner((c) => c.query('UPDATE pgboss.version SET version = 46'));
    await server.close();
    await workers.stop();
    await database.close();
  });

  const status = async () => (await fetch(`http://127.0.0.1:${server.port}/readyz`)).status;

  it('bình thường → 200', async () => {
    expect(await status()).toBe(200);
  });

  it('mất kết nối bể điều khiển → 503 trong ≤ 30 giây, có queue.fetch_failed; khôi phục → 200', async () => {
    // Chặn vai trò system (bể điều khiển) mở kết nối mới + cắt kết nối hiện có.
    await asAdmin(async (c) => {
      await c.query('ALTER ROLE "system" CONNECTION LIMIT 0');
      await c.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'system' AND datname = current_database()",
      );
    });
    const lostAt = Date.now();
    await waitFor(async () => (await status()) === 503, 45_000, 500, '/readyz 503');
    expect(Date.now() - lostAt).toBeLessThanOrEqual(31_000 + 10_000);
    expect(workers.logs.of('queue.fetch_failed').length).toBeGreaterThan(0);
    expect(workers.runtimes[0]!.isReady()).toBe(false);

    await asAdmin((c) => c.query('ALTER ROLE "system" CONNECTION LIMIT -1'));
    await waitFor(async () => (await status()) === 200, 45_000, 500, '/readyz 200 lại');
  });

  it('phiên bản schema pgboss lệch → 503 + queue.schema_version_mismatch; sửa lại → 200', async () => {
    await asOwner((c) => c.query('UPDATE pgboss.version SET version = 45'));
    await waitFor(async () => (await status()) === 503, 30_000, 500, '/readyz 503 do lệch phiên bản');
    expect(workers.logs.of('queue.schema_version_mismatch')[0]).toMatchObject({
      expected: 46,
      actual: 45,
    });
    await asOwner((c) => c.query('UPDATE pgboss.version SET version = 46'));
    await waitFor(async () => (await status()) === 200, 30_000, 500, '/readyz 200 lại');
  });
});
