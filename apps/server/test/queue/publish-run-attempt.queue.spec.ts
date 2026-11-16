// T013 (012 R10) – bộ thực thi TẠM của `publishing.run_attempt`: chạy lại hai lần cho cùng kết quả; mục đã hủy
// bị bỏ qua; `none` hoãn việc, không đổi trạng thái; `fake` đi scheduled → processing → succeeded bằng cập nhật
// có điều kiện; khuôn việc không cho trường nội dung.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { tenantTx } from '../../src/core/db/transaction';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import type { ContentPublicApi, PostRecord } from '../../src/modules/content';
import type { PlatformGatewayPublicApi } from '../../src/modules/platform_gateway';
import {
  createRunAttemptHandler,
  NO_EXECUTOR_DELAY_SECONDS,
} from '../../src/modules/publishing/internal/executor.stub';
import { runAttemptJob, runAttemptDedupeKey } from '../../src/modules/publishing/jobs';
import { defineJobType, registerJobHandler } from '../../src/modules/queue';
import { unregisterJobHandler } from '../../src/modules/queue/internal/handlers';
import { runJobInline, startTestProducer } from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const connectionId = uuidV7();

function post(id: string): PostRecord {
  return {
    id,
    status: 'approved',
    source: 'manual',
    internalName: null,
    sharedText: 'Nội dung đã duyệt',
    scheduledAt: new Date(),
    createdBy: uuidV7(),
    submittedBy: null,
    submittedAt: null,
    submissionId: null,
    approvedBy: uuidV7(),
    approvedAt: new Date(),
    returnedNote: null,
    returnedBy: null,
    returnedAt: null,
    editedAfterApproval: false,
    version: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    variants: [
      {
        id: uuidV7(),
        connectionId,
        channelType: 'test_channel',
        customized: false,
        text: '',
        hashtags: [],
        media: [],
        version: 1,
      },
    ],
  };
}

const gateway = (submitKind: 'published' | 'failed' = 'published') =>
  ({
    contentHash: () => 'hash',
    submit: () =>
      Promise.resolve(
        submitKind === 'published'
          ? { kind: 'published', platformPostId: 'p1', permalink: 'https://x.test/p1' }
          : { kind: 'failed', error: { category: 'user_action' } },
      ),
  }) as unknown as PlatformGatewayPublicApi;

describeDb('Việc publishing.run_attempt – bộ thực thi tạm', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let account: string;
  let postId: string;
  let attemptId: string;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 3 });
    stopProducer = await startTestProducer();
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });
  beforeEach(async () => {
    unregisterJobHandler(runAttemptJob.name);
    account = await createAccount();
    postId = uuidV7();
    attemptId = uuidV7();
    await asOwner((c) =>
      c.query(
        `INSERT INTO publishing.publish_attempts (id, account_id, post_id, channel_connection_id, channel_type, status, scheduled_at, content_version)
         VALUES ($1, $2, $3, $4, 'test_channel', 'scheduled', now(), 2)`,
        [attemptId, account, postId, connectionId],
      ),
    );
  });

  const status = () =>
    asOwner(
      async (c) =>
        (
          await c.query<{ status: string }>(
            'SELECT status FROM publishing.publish_attempts WHERE id = $1',
            [attemptId],
          )
        ).rows[0]?.status,
    );
  const register = (mode: 'none' | 'fake', gw = gateway()) => {
    registerJobHandler(
      runAttemptJob,
      createRunAttemptHandler({
        mode,
        content: { getPost: () => Promise.resolve(post(postId)) } as unknown as ContentPublicApi,
        gateway: gw,
      }),
    );
  };
  const run = () => runJobInline(runAttemptJob, { attemptId }, { accountId: account });

  it('none: hoãn 15 phút, KHÔNG đổi trạng thái; chạy lại hai lần cho cùng kết quả', async () => {
    register('none');
    const first = await run();
    expect(first).toMatchObject({ kind: 'retry_after', seconds: NO_EXECUTOR_DELAY_SECONDS });
    expect(await status()).toBe('scheduled');
    expect(await run()).toEqual(first);
    expect(await status()).toBe('scheduled');
  });

  it('fake: scheduled → processing → succeeded; chạy lại lần hai không tác dụng phụ', async () => {
    register('fake');
    await run();
    expect(await status()).toBe('succeeded');
    const versionAfterFirst = await asOwner(
      async (c) =>
        (
          await c.query<{ version: number }>(
            'SELECT version FROM publishing.publish_attempts WHERE id = $1',
            [attemptId],
          )
        ).rows[0]?.version,
    );
    await run();
    expect(await status()).toBe('succeeded');
    const versionAfterSecond = await asOwner(
      async (c) =>
        (
          await c.query<{ version: number }>(
            'SELECT version FROM publishing.publish_attempts WHERE id = $1',
            [attemptId],
          )
        ).rows[0]?.version,
    );
    expect(versionAfterSecond).toBe(versionAfterFirst);
  });

  it('fake: nền tảng báo lỗi cần người dùng → needs_user', async () => {
    register('fake', gateway('failed'));
    await run();
    expect(await status()).toBe('needs_user');
  });

  it('mục đã hủy bị bỏ qua (không đăng nội dung cũ), cả hai chế độ', async () => {
    await asOwner((c) =>
      c.query("UPDATE publishing.publish_attempts SET status = 'cancelled' WHERE id = $1", [
        attemptId,
      ]),
    );
    register('fake');
    expect(await run()).toBeUndefined();
    expect(await status()).toBe('cancelled');
  });

  it('hai bộ xử lý cùng chiếm một lượt → chỉ MỘT đổi được scheduled → processing', async () => {
    register('fake');
    const claim = () =>
      withAccount(account, () =>
        tenantTx(async (db) => {
          const { transitionAttempt } =
            await import('../../src/modules/publishing/internal/attempts.repository');
          return transitionAttempt(db, attemptId, 'scheduled', 'processing');
        }),
      );
    const results = await Promise.all([claim(), claim(), claim()]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('khuôn việc: khóa chống trùng publish:{attemptId}; trường nội dung bị từ chối ngay lúc khai báo', () => {
    expect(runAttemptDedupeKey(attemptId)).toBe(`publish:${attemptId}`);
    expect(runAttemptJob.payload.safeParse({ attemptId, text: 'nội dung' }).success).toBe(false);
    expect(() =>
      defineJobType({
        name: 'publishing.probe_forbidden',
        queue: 'publish',
        scope: 'tenant',
        version: 1,
        payload: z.strictObject({ attemptId: z.uuid(), text: z.string().max(100) }),
      }),
    ).toThrow();
  });
});

describe('khai báo loại việc', () => {
  it('đúng hàng chờ publish, phạm vi tenant, không cho chạy lại chung', () => {
    expect(runAttemptJob).toMatchObject({
      name: 'publishing.run_attempt',
      queue: 'publish',
      scope: 'tenant',
      version: 1,
      allowGenericRetry: false,
    });
  });
});
