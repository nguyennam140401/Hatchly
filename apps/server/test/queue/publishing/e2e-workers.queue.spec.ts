// US1/SC-010/SC-012 (013) – đầu-cuối trên 2 bản Worker THẬT: lên lịch qua giao diện công khai → hàng chờ `publish` →
// bộ xử lý 5 bước → "Đã đăng". Kiểm giới hạn đồng thời theo tài khoản (không "hàng xóm ồn ào") và việc đăng KHÔNG phụ
// thuộc Cổng AI (hết AI vẫn đăng được).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { currentAccountId, tenantTx } from '../../../src/core/db/transaction';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import type { ContentPublicApi } from '../../../src/modules/content';
import type { PlatformGatewayPublicApi } from '../../../src/modules/platform_gateway';
import { PublishingService } from '../../../src/modules/publishing/internal/publishing.service';
import { startTestWorkers, type TestWorkers } from '../../support/queue-test-kit';
import {
  createAccount,
  describeDb,
  makeDatabase,
  resetQueues,
  resetQueueSettings,
  setQueueSettings,
  sleep,
  withAccount,
  type TestDatabase,
} from '../helpers/queue-db';
import { attemptRow, makePost, makeWorld, stepRows, type World } from './harness';
import { asOwner } from '../helpers/queue-db';

const rules = [
  {
    channelType: 'test_channel',
    maxTextLength: 63206,
    maxHashtags: null,
    mediaRequired: false,
    maxPostsPer24h: null,
  },
];

describeDb('Đăng đầu-cuối trên 2 Worker', () => {
  let database: TestDatabase;
  let workers: TestWorkers | undefined;
  let world: World;
  let service: PublishingService;
  const postId = uuidV7();
  const connections = Array.from({ length: 16 }, () => uuidV7());

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 20 });
    service = new PublishingService(
      { channelRules: () => Promise.resolve(rules) } as unknown as ContentPublicApi,
      {} as PlatformGatewayPublicApi,
    );
  });
  afterAll(async () => {
    await workers?.stop();
    await resetQueueSettings();
    await database.close();
  });
  beforeEach(async () => {
    await workers?.stop();
    await resetQueues();
    await resetQueueSettings();
    await setQueueSettings('publish', { poll_interval_ms: 200 });
    world = makeWorld(postId, connections[0]!);
    // Bài có biến thể cho mọi kênh thử.
    world.post.variants = connections.map((connectionId) => ({
      ...makePost(postId, connectionId).variants[0]!,
      connectionId,
    }));
    world.register();
    workers = await startTestWorkers(2, { queues: ['publish'] });
  });

  const schedule = (account: string, conns: string[], inMs = 800) =>
    withAccount(account, () =>
      tenantTx((db) =>
        service.schedule(db, {
          postId,
          contentVersion: 2,
          scheduledAt: new Date(Date.now() + inMs),
          channels: conns.map((connectionId) => ({
            connectionId,
            channelType: 'test_channel' as const,
          })),
        }),
      ),
    );

  it('S1 + S19: bài hai kênh đúng giờ → mỗi kênh đúng một lượt thành công, đủ 5 bước; không cần Cổng AI', async () => {
    const account = await createAccount();
    const res = await schedule(account, [connections[0]!, connections[1]!]);
    expect(res.kind).toBe('scheduled');
    const ids = res.kind === 'scheduled' ? res.attempts.map((a) => a.attemptId) : [];

    await sleep(1_000);
    await workers?.drain(30_000);
    for (const id of ids) {
      expect(await attemptRow(id)).toMatchObject({ status: 'succeeded', confirmed_by: 'platform' });
      const finished = (await stepRows(id)).filter((s) => s.event === 'finished');
      expect(finished.map((s) => s.step_key)).toEqual([
        'precheck',
        'prepare_media',
        'submit',
        'await_processing',
        'confirm',
      ]);
    }
    expect(world.gateway.platformPosts).toHaveLength(2);
    expect(world.gateway.submitCalls).toBe(2);
  });

  it('SC-012: module Đăng bài không phụ thuộc/nhập Cổng AI (hết AI vẫn đăng được)', () => {
    const root = join(__dirname, '..', '..', '..', 'src', 'modules', 'publishing');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
      });
    for (const file of walk(root)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/ai_gateway|AI_GATEWAY/);
    }
    const manifest = JSON.parse(
      readFileSync(join(root, '..', 'modules.manifest.json'), 'utf8'),
    ) as { modules: { name: string; allowedDeps: string[] }[] };
    expect(manifest.modules.find((m) => m.name === 'publishing')?.allowedDeps).not.toContain(
      'ai_gateway',
    );
  });

  it('SC-010: một tài khoản bị chặn đồng thời ≤ 3 lượt, tài khoản khác không bị chậm', async () => {
    const noisy = await createAccount();
    const quiet = await createAccount();
    const running = new Map<string, number>();
    const peak = new Map<string, number>();
    world.gateway.onSubmit = async () => {
      const who = currentAccountId() ?? '?';
      const n = (running.get(who) ?? 0) + 1;
      running.set(who, n);
      peak.set(who, Math.max(peak.get(who) ?? 0, n));
      await sleep(250);
      running.set(who, (running.get(who) ?? 1) - 1);
    };
    await schedule(noisy, connections.slice(0, 12), 500);
    await schedule(quiet, connections.slice(0, 2), 500);
    await sleep(700);
    const started = Date.now();
    await workers?.drain(60_000);
    expect(peak.get(noisy)).toBeLessThanOrEqual(3);
    expect(peak.get(noisy)).toBeGreaterThan(1); // có chạy song song nhưng bị chặn ở 3
    const rows = await asOwner((c) =>
      c.query<{ account_id: string; n: string }>(
        "SELECT account_id, count(*)::text AS n FROM publishing.publish_attempts WHERE status = 'succeeded' GROUP BY account_id",
      ),
    );
    const done = Object.fromEntries(rows.rows.map((r) => [r.account_id, Number(r.n)]));
    expect(done[noisy]).toBe(12);
    expect(done[quiet]).toBe(2);
    expect(Date.now() - started).toBeLessThan(30_000); // lệch ≪ 5 phút (SC-003/010)
  });
});
