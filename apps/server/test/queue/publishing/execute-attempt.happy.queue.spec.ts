// US1 (013) – bộ xử lý `publishing.run_attempt` chạy đủ 5 bước: đồng bộ (Facebook), bất đồng bộ (Instagram),
// bài đã hủy/đổi nội dung, hoãn khi chưa bật bộ thực thi, chạy lại hai lần cho cùng kết quả.
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { NO_EXECUTOR_DELAY_SECONDS } from '../../../src/modules/publishing/internal/executor/execute-attempt.handler';
import { runAttemptDedupeKey, runAttemptJob } from '../../../src/modules/publishing/jobs';
import { defineJobType } from '../../../src/modules/queue';
import { startTestProducer } from '../../support/queue-test-kit';
import { createAccount, describeDb, makeDatabase, type TestDatabase } from '../helpers/queue-db';
import { attemptRow, makeWorld, seedAttempt, stepRows, type World } from './harness';

describeDb('Việc publishing.run_attempt – 5 bước đăng (US1)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let account: string;
  let postId: string;
  let connectionId: string;
  let world: World;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 4 });
    stopProducer = await startTestProducer();
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });
  beforeEach(async () => {
    account = await createAccount();
    postId = uuidV7();
    connectionId = uuidV7();
    world = makeWorld(postId, connectionId);
    world.register();
  });

  it('Facebook (đồng bộ): chữ → succeeded, có đường dẫn, đủ 5 bước (bước 4 không áp dụng)', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    await world.run(id, account);

    const row = await attemptRow(id);
    expect(row).toMatchObject({
      status: 'succeeded',
      phase: 'finished',
      confirmed_by: 'platform',
      platform_post_id: 'post-1',
      permalink: 'https://x.test/post-1',
      run_no: 1,
    });
    expect(world.gateway.submitCalls).toBe(1);
    expect(world.gateway.platformPosts).toHaveLength(1);

    const steps = await stepRows(id);
    expect(steps).toHaveLength(10);
    expect(steps.map((s) => `${s.step_key}:${s.event}:${s.outcome ?? '-'}`)).toEqual([
      'precheck:started:-',
      'precheck:finished:succeeded',
      'prepare_media:started:-',
      'prepare_media:finished:not_applicable',
      'submit:started:-',
      'submit:finished:succeeded',
      'await_processing:started:-',
      'await_processing:finished:not_applicable',
      'confirm:started:-',
      'confirm:finished:succeeded',
    ]);
    expect(new Set(steps.map((s) => s.run_no))).toEqual(new Set([1]));
  });

  it('nội dung gửi đúng văn bản đã duyệt + dấu nội dung ghi trước khi gửi', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    await world.run(id, account);
    expect(world.gateway.lastSubmit?.text).toBe('Nội dung đã duyệt');
    expect(world.gateway.lastSubmit?.contentHash).toBe('ch1:Nội dung đã duyệt');
    const row = await attemptRow(id);
    expect(row.content_hash).toBe('ch1:Nội dung đã duyệt');
    expect(row.submitted_at).not.toBeNull();
  });

  it('Instagram (bất đồng bộ): nền tảng nhận → chờ xử lý → xong → succeeded; bước 4 có kết quả', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.script = ['processing'];
    world.gateway.statusScript = ['processing', 'done'];

    const first = await world.run(id, account);
    expect(first).toMatchObject({ kind: 'retry_after' });
    expect(await attemptRow(id)).toMatchObject({
      status: 'processing',
      phase: 'awaiting_processing',
    });

    const second = await world.run(id, account);
    expect(second).toMatchObject({ kind: 'retry_after' });
    expect((await attemptRow(id)).status).toBe('processing');

    await world.run(id, account);
    const row = await attemptRow(id);
    expect(row).toMatchObject({ status: 'succeeded', phase: 'finished', confirmed_by: 'platform' });
    expect(world.gateway.submitCalls).toBe(1);
    expect(world.gateway.platformPosts).toHaveLength(1);
    const keys = (await stepRows(id)).filter((s) => s.event === 'finished').map((s) => s.step_key);
    expect(keys).toEqual(['precheck', 'prepare_media', 'submit', 'await_processing', 'confirm']);
  });

  it('bài đã hủy sau khi lên lịch (phiên bản nội dung lệch) → lượt cancelled, KHÔNG đăng', async () => {
    const id = await seedAttempt(account, postId, connectionId, { contentVersion: 1 });
    await world.run(id, account); // bài đang ở phiên bản 2
    expect((await attemptRow(id)).status).toBe('cancelled');
    expect(world.gateway.submitCalls).toBe(0);
  });

  it('bài không còn ở trạng thái đã duyệt → cancelled, không đăng', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.post.status = 'draft';
    await world.run(id, account);
    expect((await attemptRow(id)).status).toBe('cancelled');
    expect(world.gateway.submitCalls).toBe(0);
  });

  it('chưa bật bộ thực thi (none): hoãn 15 phút, KHÔNG đổi trạng thái', async () => {
    world.register('none');
    const id = await seedAttempt(account, postId, connectionId);
    const first = await world.run(id, account);
    expect(first).toMatchObject({ kind: 'retry_after', seconds: NO_EXECUTOR_DELAY_SECONDS });
    expect((await attemptRow(id)).status).toBe('scheduled');
    expect(await world.run(id, account)).toEqual(first);
    expect(world.gateway.submitCalls).toBe(0);
  });

  it('chạy lại hai lần việc đã succeeded: không tác dụng phụ, không đăng thêm', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    await world.run(id, account);
    const before = await attemptRow(id);
    const stepsBefore = (await stepRows(id)).length;
    expect(await world.run(id, account)).toBeUndefined();
    expect(await world.run(id, account)).toBeUndefined();
    expect(await attemptRow(id)).toEqual(before);
    expect((await stepRows(id)).length).toBe(stepsBefore);
    expect(world.gateway.platformPosts).toHaveLength(1);
  });

  it('lượt không tồn tại hoặc đã hủy → bỏ qua', async () => {
    expect(await world.run(uuidV7(), account)).toBeUndefined();
    const id = await seedAttempt(account, postId, connectionId, { status: 'cancelled' });
    expect(await world.run(id, account)).toBeUndefined();
    expect(world.gateway.submitCalls).toBe(0);
  });

  it('khuôn việc: khóa chống trùng publish:{attemptId}; trường nội dung bị từ chối', () => {
    const id = uuidV7();
    expect(runAttemptDedupeKey(id)).toBe(`publish:${id}`);
    expect(runAttemptJob.payload.safeParse({ attemptId: id, text: 'nội dung' }).success).toBe(
      false,
    );
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
