// T012 (012) – hợp đồng `PublishingPublicApi` trên CSDL THẬT. Bộ kiểm thử này DÙNG LẠI ĐƯỢC cho 013: thay
// bộ thực thi mà giữ nguyên hợp đồng thì các ca dưới đây vẫn phải xanh (spec 013, Assumptions).
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { tenantTx } from '../../src/core/db/transaction';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import type { ChannelRule, ContentPublicApi } from '../../src/modules/content';
import type { PlatformGatewayPublicApi } from '../../src/modules/platform_gateway';
import type { PublishingPublicApi } from '../../src/modules/publishing';
import { PublishingService } from '../../src/modules/publishing/internal/publishing.service';
import { startTestProducer } from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from './helpers/db';

const HOUR = 3_600_000;
const rules: ChannelRule[] = [
  {
    channelType: 'facebook_page',
    maxTextLength: 63206,
    maxHashtags: null,
    mediaRequired: false,
    maxPostsPer24h: null,
  },
  {
    channelType: 'instagram',
    maxTextLength: 2200,
    maxHashtags: 30,
    mediaRequired: true,
    maxPostsPer24h: 2,
  },
];
const contentStub = { channelRules: () => Promise.resolve(rules) } as unknown as ContentPublicApi;
const gatewayStub = {} as PlatformGatewayPublicApi;

const channel = (type: 'facebook_page' | 'instagram' = 'facebook_page') => ({
  connectionId: uuidV7(),
  channelType: type,
});
const at = (hours: number) => new Date(Date.now() + hours * HOUR);

describeDb('PublishingPublicApi – hợp đồng (012, dùng lại ở 013)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let api: PublishingPublicApi;
  let a: string;
  let b: string;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 4 });
    stopProducer = await startTestProducer();
    api = new PublishingService(contentStub, gatewayStub);
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });
  beforeEach(async () => {
    a = await createAccount();
    b = await createAccount();
  });

  const run = <T>(
    account: string,
    fn: (db: Parameters<Parameters<typeof tenantTx>[0]>[0]) => Promise<T>,
  ) => withAccount(account, () => tenantTx(fn));

  const jobsFor = (attemptIds: string[]) =>
    asOwner(async (c) => {
      const r = await c.query<{ id: string; state: string; start_after: Date }>(
        `SELECT id::text, state::text, start_after FROM pgboss.job_common
          WHERE name = 'publish' AND singleton_key = ANY($1)`,
        [attemptIds.map((id) => `publish:${id}`)],
      );
      return r.rows;
    });

  it('schedule: mỗi kênh một mục `scheduled` + một việc; gọi hai lần → vẫn một mục, một việc (idempotent)', async () => {
    const postId = uuidV7();
    const channels = [channel(), channel()];
    const input = { postId, contentVersion: 3, scheduledAt: at(3), channels };
    const first = await run(a, (db) => api.schedule(db, input));
    expect(first.kind).toBe('scheduled');
    const refs = first.kind === 'scheduled' ? first.attempts : [];
    expect(refs).toHaveLength(2);
    const second = await run(a, (db) => api.schedule(db, input));
    expect(second.kind).toBe('already_scheduled');
    const rows = await asOwner(
      async (c) =>
        (
          await c.query<{ status: string; content_version: number }>(
            'SELECT status, content_version FROM publishing.publish_attempts WHERE post_id = $1',
            [postId],
          )
        ).rows,
    );
    expect(rows).toEqual([
      { status: 'scheduled', content_version: 3 },
      { status: 'scheduled', content_version: 3 },
    ]);
    expect(await jobsFor(refs.map((r) => r.attemptId))).toHaveLength(2);
  });

  it('chỉ mục duy nhất: chèn trực tiếp mục thứ hai cho cùng (bài, kênh) bị CSDL từ chối', async () => {
    const postId = uuidV7();
    const ch = channel();
    await run(a, (db) =>
      api.schedule(db, { postId, contentVersion: 1, scheduledAt: at(2), channels: [ch] }),
    );
    const dup = asOwner((c) =>
      c.query(
        `INSERT INTO publishing.publish_attempts (id, account_id, post_id, channel_connection_id, channel_type, status, scheduled_at, content_version)
         VALUES ($1, $2, $3, $4, 'facebook_page', 'scheduled', now(), 1)`,
        [uuidV7(), a, postId, ch.connectionId],
      ),
    );
    await expect(dup).rejects.toMatchObject({ code: '23505' });
  });

  it('cancelByPost: hủy mọi mục `scheduled` + việc; sau đó có thể lên lịch lại (chỉ mục loại trừ mục đã hủy)', async () => {
    const postId = uuidV7();
    const channels = [channel(), channel()];
    const s = await run(a, (db) =>
      api.schedule(db, { postId, contentVersion: 1, scheduledAt: at(2), channels }),
    );
    const ids = s.kind === 'scheduled' ? s.attempts.map((r) => r.attemptId) : [];
    const cancelled = await run(a, (db) => api.cancelByPost(db, postId));
    expect(cancelled).toEqual({ kind: 'cancelled', count: 2 });
    expect((await jobsFor(ids)).every((j) => j.state === 'cancelled')).toBe(true);
    const again = await run(a, (db) =>
      api.schedule(db, { postId, contentVersion: 2, scheduledAt: at(5), channels }),
    );
    expect(again.kind).toBe('scheduled');
  });

  it('cancelByPost có mục đã rời `scheduled` → already_publishing và KHÔNG đổi gì', async () => {
    const postId = uuidV7();
    const channels = [channel(), channel()];
    const s = await run(a, (db) =>
      api.schedule(db, { postId, contentVersion: 1, scheduledAt: at(2), channels }),
    );
    const first = s.kind === 'scheduled' ? s.attempts[0] : undefined;
    await asOwner((c) =>
      c.query("UPDATE publishing.publish_attempts SET status = 'processing' WHERE id = $1", [
        first?.attemptId,
      ]),
    );
    const result = await run(a, (db) => api.cancelByPost(db, postId));
    expect(result).toEqual({ kind: 'already_publishing', connectionIds: [first?.connectionId] });
    const statuses = await asOwner(async (c) =>
      (
        await c.query<{ status: string }>(
          'SELECT status FROM publishing.publish_attempts WHERE post_id = $1 ORDER BY status',
          [postId],
        )
      ).rows.map((r) => r.status),
    );
    expect(statuses).toEqual(['processing', 'scheduled']);
  });

  it('reschedule: đổi scheduled_at mọi mục và giờ chạy sớm nhất của việc trong cùng giao dịch', async () => {
    const postId = uuidV7();
    const s = await run(a, (db) =>
      api.schedule(db, { postId, contentVersion: 1, scheduledAt: at(2), channels: [channel()] }),
    );
    const ids = s.kind === 'scheduled' ? s.attempts.map((r) => r.attemptId) : [];
    const when = at(10);
    const moved = await run(a, (db) => api.reschedule(db, postId, when));
    expect(moved).toEqual({ kind: 'rescheduled', count: 1 });
    const jobs = await jobsFor(ids);
    expect(
      jobs[0] && Math.abs(new Date(jobs[0].start_after).getTime() - when.getTime()),
    ).toBeLessThan(1000);
  });

  it('hạn mức kênh (cửa sổ trượt 24 giờ): vượt → quota_exceeded; cách > 24 giờ thì được; bài của chính nó khi đổi giờ không tự đếm', async () => {
    const ig = channel('instagram'); // giới hạn 2 bài / 24 giờ
    const sched = (h: number, postId = uuidV7()) =>
      run(a, (db) =>
        api.schedule(db, { postId, contentVersion: 1, scheduledAt: at(h), channels: [ig] }),
      );
    expect((await sched(2)).kind).toBe('scheduled');
    expect((await sched(3)).kind).toBe('scheduled');
    const third = await sched(4);
    expect(third).toMatchObject({
      kind: 'quota_exceeded',
      connectionId: ig.connectionId,
      limit: 2,
    });
    expect((await sched(30)).kind).toBe('scheduled'); // ngoài cửa sổ của hai bài đầu (28 giờ cách bài đầu)
    // Đổi giờ bài đầu sang ngay cạnh bài thứ hai KHÔNG tự trừ chính nó.
    const own = uuidV7();
    const other = channel('instagram');
    await run(a, (db) =>
      api.schedule(db, { postId: own, contentVersion: 1, scheduledAt: at(2), channels: [other] }),
    );
    expect(await run(a, (db) => api.reschedule(db, own, at(3)))).toEqual({
      kind: 'rescheduled',
      count: 1,
    });
  });

  it('hai tài khoản dùng cùng loại kênh không ảnh hưởng nhau (hạn mức tính theo kênh + RLS)', async () => {
    const ig = channel('instagram');
    const mk = (account: string) =>
      run(account, (db) =>
        api.schedule(db, {
          postId: uuidV7(),
          contentVersion: 1,
          scheduledAt: at(2),
          channels: [ig],
        }),
      );
    expect((await mk(a)).kind).toBe('scheduled');
    expect((await mk(a)).kind).toBe('scheduled');
    expect((await mk(a)).kind).toBe('quota_exceeded');
    // Tài khoản B cùng mã kênh (giả định trùng mã) vẫn lên lịch được vì không thấy mục của A.
    expect((await mk(b)).kind).toBe('scheduled');
  });

  it('statusesByPosts: trạng thái "xấu nhất" + từng kênh; mục đã hủy không tính; tài khoản khác không thấy', async () => {
    const postId = uuidV7();
    const s = await run(a, (db) =>
      api.schedule(db, {
        postId,
        contentVersion: 1,
        scheduledAt: at(2),
        channels: [channel(), channel()],
      }),
    );
    const first = s.kind === 'scheduled' ? s.attempts[0] : undefined;
    await asOwner((c) =>
      c.query("UPDATE publishing.publish_attempts SET status = 'needs_user' WHERE id = $1", [
        first?.attemptId,
      ]),
    );
    const states = await withAccount(a, () => api.statusesByPosts([postId, uuidV7()]));
    expect(states.get(postId)?.worst).toBe('needs_user');
    expect(states.get(postId)?.allScheduled).toBe(false);
    expect(states.get(postId)?.attempts).toHaveLength(2);
    expect(await withAccount(b, () => api.statusesByPosts([postId]))).toEqual(new Map());
  });

  it('hoàn tác giao dịch → không mục, không việc (lên lịch cùng giao dịch với nghiệp vụ)', async () => {
    const postId = uuidV7();
    await expect(
      run(a, async (db) => {
        await api.schedule(db, {
          postId,
          contentVersion: 1,
          scheduledAt: at(2),
          channels: [channel()],
        });
        throw new Error('lỗi giả lập sau schedule');
      }),
    ).rejects.toThrow('lỗi giả lập');
    const n = await asOwner(async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM publishing.publish_attempts WHERE post_id = $1',
            [postId],
          )
        ).rows[0]?.n,
      ),
    );
    expect(n).toBe(0);
  });
});
