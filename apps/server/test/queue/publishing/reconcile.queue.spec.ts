// US4 (013) – đối soát trước khi gửi lại; thử lại ĐÚNG MỘT LẦN; kênh không đối soát được → "Cần kiểm tra".
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { startTestProducer } from '../../support/queue-test-kit';
import { createAccount, describeDb, makeDatabase, type TestDatabase } from '../helpers/queue-db';
import { attemptRow, makeWorld, seedAttempt, stepRows, type World } from './harness';

const MIN = 60_000;

describeDb('Đối soát và "Cần kiểm tra" (US4)', () => {
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

  it('S9: hết thời gian chờ SAU khi nền tảng đã nhận → đối soát thấy bài → succeeded, đúng 1 bài', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.script = ['timeout_after_publish'];
    const first = await world.run(id, account);
    expect((await attemptRow(id)).status).toBe('unknown');
    expect(first).toMatchObject({ kind: 'retry_after' });

    world.clock.offsetMs = 3 * MIN;
    await world.run(id, account);
    const row = await attemptRow(id);
    expect(row).toMatchObject({ status: 'succeeded', confirmed_by: 'reconciliation' });
    expect(world.gateway.submitCalls).toBe(1);
    expect(world.gateway.platformPosts).toHaveLength(1);
    const confirm = (await stepRows(id))
      .filter((s) => s.step_key === 'confirm' && s.event === 'finished')
      .at(-1);
    expect(confirm?.note).toBe('Xác nhận nhờ đối soát');
  });

  it('S10: chưa thấy bài sau 10 phút → thử lại ĐÚNG MỘT LẦN rồi đăng được (không trùng)', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    // Lần 1: nền tảng KHÔNG nhận nhưng báo mơ hồ (không tạo bài).
    world.gateway.script = [
      { fail: { ...(await import('./harness')).err('unknown', 'TIMEOUT_BEFORE') } },
      'published',
    ];
    await world.run(id, account);
    expect((await attemptRow(id)).status).toBe('unknown');

    world.clock.offsetMs = 3 * MIN;
    world.gateway.reconcileOutcome = 'not_found';
    const mid = await world.run(id, account);
    expect(mid).toMatchObject({ kind: 'retry_after', seconds: 120 }); // chưa đủ 10 phút: hỏi lại
    expect((await attemptRow(id)).status).toBe('unknown');

    world.clock.offsetMs = 11 * MIN;
    const retry = await world.run(id, account);
    expect(retry).toMatchObject({ kind: 'retry_after' });
    expect(await attemptRow(id)).toMatchObject({
      status: 'retry_wait',
      reconcile_retry_used: true,
      phase: 'none',
    });
    expect(world.gateway.submitCalls).toBe(1);

    await world.run(id, account); // lần thử lại duy nhất
    expect((await attemptRow(id)).status).toBe('succeeded');
    expect(world.gateway.submitCalls).toBe(2);
    expect(world.gateway.platformPosts).toHaveLength(1);
  });

  it('lần thử lại mà vẫn mơ hồ → needs_check (reconcile_failed), KHÔNG thử lần nữa, có thông báo', async () => {
    const id = await seedAttempt(account, postId, connectionId, {
      status: 'unknown',
      phase: 'submitted_awaiting_response',
      extra: {
        run_no: 2,
        reconcile_retry_used: true,
        content_hash: 'ch1:Nội dung đã duyệt',
        submitted_at: new Date(),
      },
    });
    world.gateway.reconcileOutcome = 'not_found';
    world.clock.offsetMs = 11 * MIN;
    await world.run(id, account);
    expect(await attemptRow(id)).toMatchObject({
      status: 'needs_check',
      needs_reason: 'reconcile_failed',
    });
    expect(world.emitted).toHaveLength(1);
    expect(world.emitted[0]).toMatchObject({ refs: { state: 'needs_check' } });
    expect(world.gateway.submitCalls).toBe(0);
    // Trạng thái chờ người dùng: chạy lại không làm gì.
    expect(await world.run(id, account)).toBeUndefined();
  });

  it('S11: kênh không đối soát được + không xác định → needs_check NGAY + thông báo', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.canReconcile = false;
    world.gateway.script = ['timeout_after_publish'];
    await world.run(id, account);
    expect((await attemptRow(id)).status).toBe('unknown');
    await world.run(id, account);
    expect(await attemptRow(id)).toMatchObject({
      status: 'needs_check',
      needs_reason: 'uncertain_result',
    });
    expect(world.emitted).toHaveLength(1);
    expect(world.gateway.submitCalls).toBe(1);
  });

  it('nền tảng trả "không hỗ trợ đối soát" → needs_check', async () => {
    const id = await seedAttempt(account, postId, connectionId, {
      status: 'unknown',
      phase: 'submitted_awaiting_response',
      extra: { run_no: 1, content_hash: 'ch1:x', submitted_at: new Date() },
    });
    world.gateway.reconcileOutcome = 'unsupported';
    world.clock.offsetMs = 3 * MIN;
    await world.run(id, account);
    expect((await attemptRow(id)).status).toBe('needs_check');
  });

  it('đối soát lỗi mạng → hỏi lại sau, KHÔNG đổi trạng thái, KHÔNG gửi lại', async () => {
    const id = await seedAttempt(account, postId, connectionId, {
      status: 'unknown',
      phase: 'submitted_awaiting_response',
      extra: { run_no: 1, content_hash: 'ch1:x', submitted_at: new Date() },
    });
    world.gateway.reconcileOutcome = 'throw';
    world.clock.offsetMs = 3 * MIN;
    const r = await world.run(id, account);
    expect(r).toMatchObject({ kind: 'retry_after', seconds: 120 });
    expect((await attemptRow(id)).status).toBe('unknown');
    expect(world.gateway.submitCalls).toBe(0);
  });

  it('đối soát: dấu nội dung ổn định với emoji/ký tự đặc biệt (so đúng hash đã ghi)', async () => {
    world.post.sharedText = 'Khai trương 🎉 "ưu đãi" – 50% & hơn thế';
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.script = ['timeout_after_publish'];
    await world.run(id, account);
    world.clock.offsetMs = 3 * MIN;
    await world.run(id, account);
    expect((await attemptRow(id)).status).toBe('succeeded');
    expect(world.gateway.platformPosts).toHaveLength(1);
  });

  it('Instagram: chờ xử lý quá trần → không xác định → đối soát, không gửi lại', async () => {
    const id = await seedAttempt(account, postId, connectionId, {
      status: 'processing',
      phase: 'awaiting_processing',
      extra: {
        run_no: 1,
        content_hash: 'ch1:Nội dung đã duyệt',
        submitted_at: new Date(),
        processing_id: 'proc-1',
      },
    });
    world.clock.offsetMs = 15 * MIN; // quá trần 10 phút của ảnh
    await world.run(id, account);
    expect((await attemptRow(id)).status).toBe('unknown');
    expect(world.gateway.submitCalls).toBe(0);
  });

  it('Instagram: nền tảng báo lỗi media khi xử lý → needs_user (không đăng lại tự động)', async () => {
    const id = await seedAttempt(account, postId, connectionId, {
      status: 'processing',
      phase: 'awaiting_processing',
      extra: {
        run_no: 1,
        content_hash: 'ch1:Nội dung đã duyệt',
        submitted_at: new Date(),
        processing_id: 'proc-1',
      },
    });
    world.gateway.statusScript = ['failed_user'];
    await world.run(id, account);
    expect((await attemptRow(id)).status).toBe('needs_user');
    expect(world.gateway.submitCalls).toBe(0);
  });
});
