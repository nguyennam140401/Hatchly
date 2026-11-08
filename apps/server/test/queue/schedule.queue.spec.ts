// 003 T055 – US5 AS1–4, FR-026…028, edge case đồng hồ lệch: việc định kỳ đúng một lần mỗi khung trên 2
// bản, chống chồng, không bỏ khung khi còn một bản, không bù hàng loạt, khung tính bằng giờ CSDL.
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineJobType, defineSchedule, registerJobHandler } from '../../src/modules/queue';
import { SchedulerService } from '../../src/modules/queue/internal/scheduler/scheduler';
import { startTestWorkers, type TestWorkers } from '../support/queue-test-kit';
import {
  asOwner,
  describeDb,
  makeDatabase,
  resetQueues,
  resetQueueSettings,
  setQueueSettings,
  sleep,
  waitFor,
  type TestDatabase,
} from './helpers/queue-db';

const empty = z.strictObject({});
const runs = new Map<string, { start: number; end?: number }[]>();
const overlapHoldMs = 0;

function scheduled(name: string, holdMs = 0) {
  const jobType = defineJobType({
    name: `sandbox.${name}`,
    queue: 'scheduled',
    scope: 'system',
    version: 1,
    payload: empty,
  });
  registerJobHandler(jobType, async () => {
    const list = runs.get(name) ?? [];
    const run: { start: number; end?: number } = { start: Date.now() };
    list.push(run);
    runs.set(name, list);
    await sleep(holdMs || overlapHoldMs);
    run.end = Date.now();
  });
  return defineSchedule({ name: `sandbox.${name}`, cron: '*/2 * * * * *', tz: 'UTC', jobType });
}

const every2 = scheduled('every_two');
const overlap = scheduled('overlapping', 5000);
const survivor = scheduled('survivor');
const restart = scheduled('restart');
const skewed = scheduled('skewed');

interface SlotRow {
  slot: string;
  slot_at: Date;
  status: string;
  job_id: string | null;
  late_seconds: number;
}
const slotsOf = (name: string) =>
  asOwner(
    async (c) =>
      (
        await c.query<SlotRow>(
          'SELECT slot, slot_at, status, job_id::text, late_seconds FROM infra.schedule_slots WHERE name = $1 ORDER BY slot_at',
          [name],
        )
      ).rows,
  );

/** Khung liên tiếp 2 giây một, không thiếu. */
function expectContiguous(rows: SlotRow[]): void {
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i]!.slot_at.getTime() - rows[i - 1]!.slot_at.getTime()).toBe(2000);
  }
}

describeDb('US5 – việc định kỳ trên nhiều bản', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 10 });
    await resetQueues();
    await setQueueSettings('scheduled', { poll_interval_ms: 200 });
  });
  afterAll(async () => {
    await resetQueueSettings();
    await database.close();
  });

  const start = (n: 1 | 2, only: string[]): Promise<TestWorkers> =>
    startTestWorkers(n, {
      queues: ['scheduled'],
      services: () => [new SchedulerService({ tickMs: 300, appEnv: 'test', only })],
    });

  it('2 bản, lịch mỗi 2 giây × 15 khung → đúng 1 lần/khung, 15 dòng enqueued, 0 trùng', async () => {
    const workers = await start(2, [every2.name]);
    try {
      await waitFor(async () => (await slotsOf(every2.name)).length >= 16, 45_000, 200, '16 khung');
    } finally {
      await workers.stop();
    }
    const rows = (await slotsOf(every2.name)).slice(0, 15);
    expect(rows).toHaveLength(15);
    expectContiguous(rows);
    expect(rows.every((r) => r.status === 'enqueued' && r.job_id !== null)).toBe(true);
    expect(new Set(rows.map((r) => r.slot)).size).toBe(15);
    const ran = runs.get('every_two') ?? [];
    expect(ran.length).toBeGreaterThanOrEqual(15);
    expect(ran.length).toBeLessThanOrEqual((await slotsOf(every2.name)).length);
  });

  it('bộ xử lý 5 giây, lịch 2 giây → khung chồng ghi skipped_overlap, không hai lượt cùng tên chồng nhau', async () => {
    const workers = await start(2, [overlap.name]);
    try {
      await waitFor(async () => (await slotsOf(overlap.name)).length >= 6, 30_000, 200, '6 khung');
    } finally {
      await workers.stop();
    }
    const rows = await slotsOf(overlap.name);
    expect(rows.some((r) => r.status === 'skipped_overlap')).toBe(true);
    expect(rows.some((r) => r.status === 'enqueued')).toBe(true);
    const ran = (runs.get('overlapping') ?? []).filter((r) => r.end !== undefined);
    for (let i = 1; i < ran.length; i++)
      expect(ran[i]!.start).toBeGreaterThanOrEqual(ran[i - 1]!.end!);
  });

  it('dừng 1 bản giữa chừng → không khung nào thiếu', async () => {
    const workers = await start(2, [survivor.name]);
    try {
      await waitFor(async () => (await slotsOf(survivor.name)).length >= 3, 20_000, 200, '3 khung');
      await workers.runtimes[0]!.stop();
      const before = (await slotsOf(survivor.name)).length;
      await waitFor(
        async () => (await slotsOf(survivor.name)).length >= before + 4,
        20_000,
        200,
        '4 khung nữa',
      );
    } finally {
      await workers.runtimes[1]!.stop();
    }
    expectContiguous(await slotsOf(survivor.name));
  });

  it('dừng cả 2 qua ≥ 3 khung rồi bật lại → chỉ khung hiện tại chạy (không bù), late_seconds đúng', async () => {
    let workers = await start(2, [restart.name]);
    await waitFor(async () => (await slotsOf(restart.name)).length >= 2, 20_000, 200, '2 khung');
    await workers.stop();
    const before = await slotsOf(restart.name);
    await sleep(7000);
    workers = await start(1, [restart.name]);
    try {
      await waitFor(
        async () => (await slotsOf(restart.name)).length > before.length,
        10_000,
        100,
        'khung mới',
      );
      await sleep(200);
    } finally {
      await workers.stop();
    }
    const after = await slotsOf(restart.name);
    const fresh = after.slice(before.length);
    // Khung đầu tiên sau khi bật lại cách khung cuối trước đó ≥ 3 khung (không bù khung lỡ).
    expect(fresh[0]!.slot_at.getTime() - before.at(-1)!.slot_at.getTime()).toBeGreaterThanOrEqual(
      6000,
    );
    expect(fresh[0]!.late_seconds).toBeGreaterThanOrEqual(0);
    expect(fresh[0]!.late_seconds).toBeLessThanOrEqual(2);
  });

  it('giờ máy Worker lệch +5 phút (Date.now giả) → khung vẫn tính bằng giờ CSDL', async () => {
    const realNow = Date.now.bind(Date);
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 5 * 60_000);
    const workers = await start(1, [skewed.name]);
    try {
      await waitFor(async () => (await slotsOf(skewed.name)).length >= 2, 20_000, 200, '2 khung');
    } finally {
      await workers.stop();
      spy.mockRestore();
    }
    const dbNow = await asOwner(async (c) =>
      (await c.query<{ t: Date }>('SELECT now() AS t')).rows[0]!.t.getTime(),
    );
    for (const row of await slotsOf(skewed.name)) {
      expect(Math.abs(dbNow - row.slot_at.getTime())).toBeLessThan(60_000);
    }
  });
});
