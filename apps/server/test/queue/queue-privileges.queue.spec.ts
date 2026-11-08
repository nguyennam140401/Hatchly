// 003 T022 – R12, nguyên tắc I: phòng thủ hai lớp trên bảng việc của pg-boss.
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { DbPolicyViolationError } from '../../src/core/db/errors';
import { systemTx, tenantTx } from '../../src/core/db/transaction';
import { defineJobType, enqueue } from '../../src/modules/queue';
import { startTestProducer } from '../support/queue-test-kit';
import {
  createAccount,
  dbUrls,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const tenantJob = defineJobType({
  name: 'sandbox.priv_tenant',
  queue: 'notify',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ refId: z.uuid() }),
});
const systemJob = defineJobType({
  name: 'sandbox.priv_system',
  queue: 'scheduled',
  scope: 'system',
  version: 1,
  payload: z.strictObject({}),
});

async function asRole<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

describeDb('Quyền và RLS trên schema pgboss', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let a: string;
  let b: string;
  let jobB: string;
  let jobSys: string;

  beforeAll(async () => {
    database = makeDatabase();
    stopProducer = await startTestProducer();
    a = await createAccount();
    b = await createAccount();
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });
  beforeEach(async () => {
    await resetQueues();
    await withAccount(a, () => tenantTx(() => enqueue(tenantJob, { refId: crypto.randomUUID() })));
    jobB = (
      await withAccount(b, () => tenantTx(() => enqueue(tenantJob, { refId: crypto.randomUUID() })))
    ).jobId;
    jobSys = (await systemTx(() => enqueue(systemJob, {}))).jobId;
  });

  it('app trong ngữ cảnh A: SELECT chỉ thấy việc của A – không thấy B, không thấy việc hệ thống', async () => {
    const seen = await withAccount(a, () =>
      tenantTx(async (db) => {
        const r = await db.$client.query<{ group_id: string | null }>(
          'SELECT group_id FROM pgboss.job_common',
        );
        const viaParent = await db.$client.query('SELECT 1 FROM pgboss.job');
        return { rows: r.rows, parent: viaParent.rowCount };
      }),
    );
    expect(seen.rows.map((r) => r.group_id)).toEqual([a]);
    expect(seen.parent).toBe(1);
  });

  it('app trong ngữ cảnh A: UPDATE/DELETE việc của B và việc hệ thống → 0 dòng', async () => {
    const affected = await withAccount(a, () =>
      tenantTx(async (db) => {
        const u = await db.$client.query(
          'UPDATE pgboss.job_common SET priority = 99 WHERE id = ANY($1::uuid[])',
          [[jobB, jobSys]],
        );
        const d = await db.$client.query(
          'DELETE FROM pgboss.job_common WHERE id = ANY($1::uuid[])',
          [[jobB, jobSys]],
        );
        return [u.rowCount, d.rowCount];
      }),
    );
    expect(affected).toEqual([0, 0]);
    expect((await jobs()).filter((j) => j.priority === 99)).toHaveLength(0);
    expect(await jobs()).toHaveLength(3);
  });

  it('app trong ngữ cảnh A: chèn việc group_id = B hoặc NULL → DbPolicyViolationError', async () => {
    for (const group of [b, null]) {
      await expect(
        withAccount(a, () =>
          tenantTx((db) =>
            db.$client.query(
              `INSERT INTO pgboss.job_common (id, name, data, group_id, singleton_key, policy)
               VALUES (gen_random_uuid(), 'notify', '{}'::jsonb, $1, $2, 'exclusive')`,
              [group, `x:${crypto.randomUUID()}`],
            ),
          ),
        ),
      ).rejects.toBeInstanceOf(DbPolicyViolationError);
    }
  });

  it('app không có ngữ cảnh tenant (kết nối thô) → 0 dòng', async () => {
    const n = await asRole(dbUrls.app, async (c) => {
      return (await c.query('SELECT 1 FROM pgboss.job_common')).rowCount;
    });
    expect(n).toBe(0);
  });

  it('support không có quyền nào trên schema pgboss', async () => {
    await asRole(dbUrls.support, async (c) => {
      await expect(c.query('SELECT 1 FROM pgboss.job_common')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(c.query('SELECT 1 FROM pgboss.queue')).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('system đọc được mọi việc (Worker phục vụ mọi tenant)', async () => {
    const n = await asRole(dbUrls.system, async (c) => {
      return (await c.query('SELECT 1 FROM pgboss.job_common')).rowCount;
    });
    expect(n).toBe(3);
  });

  it('app/system không có quyền CREATE trên schema pgboss', async () => {
    for (const url of [dbUrls.app, dbUrls.system]) {
      await asRole(url, async (c) => {
        await expect(c.query('CREATE TABLE pgboss.x (id int)')).rejects.toMatchObject({
          code: '42501',
        });
      });
    }
  });
});
