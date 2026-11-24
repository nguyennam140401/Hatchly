// 005 T088 (SC-007, quickstart.md mục 4): toàn luồng trên bản giả lập, KHÔNG kết nối ra ngoài máy cục bộ
// (deny-egress nạp ngay đầu tệp). API thật (kho sandbox) + runtime Worker thật trong tiến trình cho hàng
// chờ `notify`; kho tệp bộ nhớ (MinIO kiểm riêng ở pnpm test:infra).
import '../helpers/deny-egress.cjs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { executionStorage } from '../../src/core/context/execution-storage';
import { MemoryMailTransport } from '../../src/core/mail/memory.transport';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { loc, OBJECT_STORAGE } from '../../src/core/storage';
import type { MemoryObjectStorage } from '../../src/core/storage/memory/memory-storage';
import { listActiveMembers } from '../../src/modules/account/internal/members-directory';
import {
  PLATFORM_GATEWAY,
  type PlatformGatewayPublicApi,
} from '../../src/modules/platform_gateway';
import { deliverNotification } from '../../src/modules/notifications/internal/deliver.handler';
import { getNotificationStore } from '../../src/modules/notifications/internal/fake';
import { notifyDeliverJob } from '../../src/modules/notifications/jobs';
import { registerJobHandler } from '../../src/modules/queue';
import { getHandler } from '../../src/modules/queue/internal/handlers';
import { createActors, type Actors } from '../auth/helpers/actors';
import { createTestApp, type TestApp } from '../auth/helpers/app';
import { describeDb } from '../db/helpers/db';
import { jobs, waitFor } from '../queue/helpers/queue-db';
import { startTestWorkers, type TestWorkers } from '../support/queue-test-kit';
import { samplePublishFlow } from '../contracts/platform/sample-publish-flow';
import { expectCustomerSafeRemedy } from '../contracts/ai/message-assert';

const WEB = 'http://app.test';
const mail = new MemoryMailTransport();

describeDb('Luồng chạy cục bộ bằng bản giả lập (SC-007)', () => {
  let t: TestApp;
  let actors: Actors;
  let workers: TestWorkers;

  beforeAll(async () => {
    // Bộ xử lý của "Worker" đăng ký TRƯỚC khi dựng API (API từ chối đăng ký bộ xử lý – QUEUE_HANDLER_ON_API).
    if (getHandler(notifyDeliverJob.name) === undefined) {
      const store = await getNotificationStore('sandbox');
      registerJobHandler(notifyDeliverJob, async ({ event }) => {
        await deliverNotification(event, {
          store,
          members: { listActiveMembers },
          mailer: mail,
          webBaseUrl: WEB,
        });
      });
    }
    t = await createTestApp({
      env: { FAKE_STATE_STORE: 'sandbox', PLATFORM_SUBMIT_TIMEOUT_MS: '5000' },
    });
    actors = await createActors(t);
    workers = await startTestWorkers(1, { queues: ['notify'] });
  });
  afterAll(async () => {
    await workers.stop();
    await t.close();
  });

  /** Chạy trong ngữ cảnh tài khoản của chủ (như một việc nền / mô-đun Đăng bài của tài khoản đó). */
  const asOwner = <T>(fn: () => Promise<T>) =>
    executionStorage.run(
      { traceId: uuidV7(), source: 'job', accountId: actors.ownerMe.account.id },
      fn,
    );

  it('kết nối kênh → đăng (unknown → đối soát) → AI → chặn ngân sách → 80% → tải tệp', async () => {
    const owner = actors.owner;
    // 1. Kết nối kênh giả qua trang ủy quyền giả.
    const start = await owner.post('/api/v1/channels/connect', { channelType: 'facebook_page' });
    expect(start.status).toBe(200);
    const page = await owner.get((start.body as { authorizeUrl: string }).authorizeUrl);
    expect(page.status).toBe(200);
    const approve = /id="approve" href="([^"]+)"/.exec(page.text)?.[1]?.replace(/&#38;/g, '&');
    expect(approve).toBeDefined();
    const cb = await owner.get(new URL(approve!).pathname + new URL(approve!).search);
    expect(cb.status).toBe(302);
    const selectionId = new URL(cb.headers.location!, 'http://app.test').pathname.split('/').pop()!;
    const sel = await owner.get(`/api/v1/channels/selections/${selectionId}`);
    const candidate = (
      sel.body as { candidates: { externalId: string; selectable: boolean }[] }
    ).candidates.find((c) => c.selectable)!;
    const saved = await owner.post('/api/v1/channels', {
      selectionId,
      externalId: candidate.externalId,
    });
    expect(saved.status).toBe(201);
    const connectionId = (saved.body as { connectionId: string }).connectionId;
    const list = await owner.get('/api/v1/channels');
    expect(JSON.stringify(list.body)).not.toMatch(/fake_tok_|accessToken|ciphertext/);

    // 2. Hết thời gian SAU khi lên → unknown → đối soát found → publishedCount = 1.
    const put = await owner.put('/api/v1/dev/fakes/scenarios', {
      component: 'platform',
      target: `connection:${connectionId}`,
      spec: { submit: 'timeout_after_publish' },
      remainingUses: 1,
    });
    expect(put.status).toBe(200);
    const gateway = t.app.get<PlatformGatewayPublicApi>(PLATFORM_GATEWAY);
    const outcome = await asOwner(() =>
      samplePublishFlow(gateway, {
        connectionId,
        text: 'Khai trương quán Gió https://gio.vn',
        sentAt: new Date(),
      }),
    );
    expect(outcome.kind).toBe('published');
    const posts = await owner.get('/api/v1/dev/fakes/platform/posts');
    expect(
      Object.values((posts.body as { publishedCount: Record<string, number> }).publishedCount),
    ).toEqual([1]);

    // 3. AI thật đi đủ trình tự → used tăng.
    const before = (await owner.get('/api/v1/dev/fakes/ai/budget')).body as { used: number };
    expect(
      (
        await owner.post('/api/v1/dev/fakes/ai/generate', {
          task: 'post_generation',
          delta: 'Viết bài',
        })
      ).status,
    ).toBe(200);
    const after = (await owner.get('/api/v1/dev/fakes/ai/budget')).body as { used: number };
    expect(after.used).toBeGreaterThan(before.used);

    // 4. Vượt 80% → thông báo ai_usage_80 + thư không có số tiền.
    await owner.put('/api/v1/dev/fakes/ai/budget', { used: 3_199_999 });
    expect(
      (
        await owner.post('/api/v1/dev/fakes/ai/generate', {
          task: 'post_generation',
          delta: 'Viết tiếp',
        })
      ).status,
    ).toBe(200);
    await waitFor(
      async () =>
        (
          await jobs(
            "data->>'type' = 'notifications.deliver' AND state IN ('created','retry','active')",
          )
        ).length === 0,
      20_000,
      100,
      'hết việc notify',
    );
    const notes = (await owner.get('/api/v1/dev/fakes/notifications')).body as {
      type: string;
      channel: string;
    }[];
    expect(
      notes
        .filter((n) => n.type === 'ai_usage_80')
        .map((n) => n.channel)
        .sort(),
    ).toEqual(['email', 'in_app']);
    const letter = mail.outbox().find((m) => m.subject.includes('80%'));
    expect(letter).toBeDefined();
    expect(JSON.stringify(letter)).not.toMatch(/\$|USD|micro/);

    // 5. Sát trần → lời gọi tiếp bị chặn, thông điệp không số tiền.
    await owner.put('/api/v1/dev/fakes/ai/budget', { used: 3_999_990 });
    const blocked = await owner.post('/api/v1/dev/fakes/ai/generate', {
      task: 'post_generation',
      delta: 'Thêm',
    });
    expect(blocked.status).toBe(409);
    const blockedMessage = (blocked.body as { error: { message: string } }).error.message;
    expect(blockedMessage).toContain('giới hạn AI');
    expectCustomerSafeRemedy(blockedMessage);

    // 6. Đường dẫn tải lên → "trình duyệt" tải → stat thấy đúng vị trí tenants/<acc>/media/<id>/original.
    const up = await owner.post('/api/v1/dev/fakes/storage/upload-url', {
      contentType: 'image/png',
      maxBytes: 10_000,
    });
    expect(up.status).toBe(200);
    const body = up.body as { mediaId: string; fields: Record<string, string> };
    expect(body.fields.key).toBe(
      `tenants/${actors.ownerMe.account.id}/media/${body.mediaId}/original`,
    );
    const storage = t.app.get<MemoryObjectStorage>(OBJECT_STORAGE);
    await storage.simulateBrowserUpload(
      { fields: body.fields },
      Buffer.from('png-bytes'),
      'image/png',
    );
    expect(await asOwner(() => storage.stat(loc.mediaOriginal(body.mediaId)))).toMatchObject({
      exists: true,
      bytes: 9,
    });
  }, 120_000);
});
