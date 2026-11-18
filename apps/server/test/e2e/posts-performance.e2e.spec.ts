// T090 (012 SC-006, SC-008) – hiệu năng phía máy chủ trên CSDL thật: duyệt 1 bài ≤ 300 ms, duyệt 50 bài ≤ 10 giây,
// Lịch tháng 200 bài và Chờ duyệt 100 bài ≤ 2 giây. Ngưỡng có biên an toàn cho máy kiểm thử chậm.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { QueueLifecycle } from '../../src/modules/queue';
import { createActors, type Actors } from '../auth/helpers/actors';
import { createTestApp, type TestApp } from '../auth/helpers/app';
import { describeDb } from '../db/helpers/db';
import { connectChannel, createDraft, inMinutes, P, type PostBody } from './helpers/posts';

describeDb('Hiệu năng duyệt, Lịch, Chờ duyệt (012 SC-006, SC-008)', () => {
  let t: TestApp;
  let actors: Actors;
  let fb: string;

  beforeAll(async () => {
    t = await createTestApp({ env: { FAKE_STATE_STORE: 'sandbox' } });
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    actors = await createActors(t);
    fb = await connectChannel(actors.owner, 'facebook_page', 0);
  });
  afterAll(async () => {
    await t.close();
  });

  const timed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
    const start = performance.now();
    const value = await fn();
    return [value, performance.now() - start];
  };

  it('duyệt 1 bài ≤ 300 ms (khởi động nóng); duyệt 50 bài một lần ≤ 10 giây', async () => {
    // Khởi động nóng: lần đầu nạp bộ nhớ đệm giới hạn kênh, kết nối cơ sở dữ liệu…
    const warm = await createDraft(actors.owner, [{ connectionId: fb }]);
    await actors.owner.post(`${P}/${warm.id}/approve`, {
      expectedVersion: warm.version,
      scheduledAt: inMinutes(120),
    });
    const one = await createDraft(actors.owner, [{ connectionId: fb }]);
    const [res, ms] = await timed(() =>
      actors.owner.post(`${P}/${one.id}/approve`, {
        expectedVersion: one.version,
        scheduledAt: inMinutes(130),
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(ms).toBeLessThan(300);

    const posts: PostBody[] = [];
    for (let i = 0; i < 50; i++) {
      posts.push(await createDraft(actors.owner, [{ connectionId: fb }]));
    }
    const [batch, batchMs] = await timed(() =>
      actors.owner.post('/api/v1/approvals/approve-batch', {
        items: posts.map((p, i) => ({
          postId: p.id,
          expectedVersion: p.version,
          scheduledAt: inMinutes(200 + i),
        })),
      }),
    );
    expect(batch.body).toMatchObject({ succeeded: 50, failed: 0 });
    expect(batchMs).toBeLessThan(10_000);
  }, 120_000);

  it('Lịch tháng 200 bài và Chờ duyệt 100 bài ≤ 2 giây', async () => {
    const base = Date.now() + 40 * 86_400_000;
    for (let i = 0; i < 200; i++) {
      await createDraft(actors.owner, [{ connectionId: fb }], {
        scheduledAt: new Date(base + i * 600_000).toISOString(),
      });
    }
    const from = new Date(base - 3_600_000).toISOString();
    const to = new Date(base + 40 * 86_400_000).toISOString();
    const [cal, calMs] = await timed(() =>
      actors.owner.get(`/api/v1/calendar?from=${from}&to=${to}`),
    );
    expect((cal.body as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(200);
    expect(calMs).toBeLessThan(2000);

    const pending: PostBody[] = [];
    for (let i = 0; i < 100; i++) {
      pending.push(
        await createDraft(actors.collaborator, [{ connectionId: fb }], {
          scheduledAt: inMinutes(500 + i),
        }),
      );
    }
    const submit = await actors.collaborator.post(`${P}/submit`, {
      items: pending.slice(0, 50).map((p) => ({ postId: p.id, expectedVersion: p.version })),
    });
    const submit2 = await actors.collaborator.post(`${P}/submit`, {
      items: pending.slice(50).map((p) => ({ postId: p.id, expectedVersion: p.version })),
    });
    expect((submit.body as { succeeded: number }).succeeded).toBe(50);
    expect((submit2.body as { succeeded: number }).succeeded).toBe(50);
    const [list, listMs] = await timed(() =>
      actors.owner.get('/api/v1/approvals/pending?limit=100'),
    );
    expect((list.body as { items: unknown[] }).items).toHaveLength(100);
    expect(listMs).toBeLessThan(2000);
  }, 240_000);
});
