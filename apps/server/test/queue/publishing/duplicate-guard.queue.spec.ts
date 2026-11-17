// US2 (013) – KHÔNG BAO GIỜ đăng trùng (Hiến pháp II): hai Worker cùng nhận một lượt, Worker chết ngay sau ghi dấu,
// chết sau khi nền tảng đã nhận, việc bị hủy bởi tín hiệu, chạy lại hai lần. Mọi ca khẳng định số bài trên nền tảng giả ≤ 1.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { startTestProducer } from '../../support/queue-test-kit';
import { createAccount, describeDb, makeDatabase, type TestDatabase } from '../helpers/queue-db';
import { attemptRow, makeWorld, seedAttempt, type World } from './harness';

const MIN = 60_000;

describeDb('Chống đăng trùng (US2)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let account: string;
  let postId: string;
  let connectionId: string;
  let world: World;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 6 });
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

  const stamped = (extra: Record<string, unknown> = {}) =>
    seedAttempt(account, postId, connectionId, {
      status: 'processing',
      phase: 'submitted_awaiting_response',
      extra: {
        run_no: 1,
        content_hash: 'ch1:Nội dung đã duyệt',
        submitted_at: new Date(),
        ...extra,
      },
    });

  it('hai Worker cùng nhận một lượt → chỉ một chiếm được, nền tảng chỉ nhận MỘT bài', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    // Làm chậm `submit` để hai bộ xử lý thật sự chồng nhau.
    world.gateway.onSubmit = () => new Promise((r) => setTimeout(r, 150));
    await Promise.all([world.run(id, account), world.run(id, account), world.run(id, account)]);
    expect(world.gateway.submitCalls).toBe(1);
    expect(world.gateway.platformPosts).toHaveLength(1);
    expect((await attemptRow(id)).status).toBe('succeeded');
  });

  it('Worker chết NGAY SAU ghi dấu (trước submit) → lần sau đối soát, KHÔNG gọi submit', async () => {
    const id = await stamped();
    const first = await world.run(id, account);
    // Chưa tới giờ đối soát đầu (2 phút) → chờ, không gửi.
    expect(first).toMatchObject({ kind: 'retry_after' });
    expect(world.gateway.submitCalls).toBe(0);
    expect((await attemptRow(id)).status).toBe('unknown');
  });

  it('Worker chết SAU submit, trước ghi kết quả → đối soát thấy bài → succeeded, bài giả = 1', async () => {
    const id = await stamped();
    world.gateway.platformPosts.push({ id: 'post-1', hash: 'ch1:Nội dung đã duyệt' });
    world.clock.offsetMs = 3 * MIN;
    await world.run(id, account);
    const row = await attemptRow(id);
    expect(row).toMatchObject({
      status: 'succeeded',
      confirmed_by: 'reconciliation',
      platform_post_id: 'post-1',
    });
    expect(world.gateway.submitCalls).toBe(0);
    expect(world.gateway.platformPosts).toHaveLength(1);
  });

  it('lượt `processing` đã ghi dấu bị giao lại → chuyển unknown rồi đối soát (không gửi)', async () => {
    const id = await stamped();
    world.clock.offsetMs = 3 * MIN;
    world.gateway.reconcileOutcome = 'not_found';
    await world.run(id, account);
    expect(['unknown']).toContain((await attemptRow(id)).status);
    expect(world.gateway.submitCalls).toBe(0);
  });

  it('khóa hết/Worker tắt trong lúc submit → KHÔNG ghi kết quả; lần sau đối soát, không gửi lại', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    const controller = new AbortController();
    world.gateway.onSubmit = () => {
      controller.abort();
      return Promise.resolve();
    };
    await world.run(id, account, controller.signal);
    // Nền tảng đã nhận (1 bài) nhưng bộ xử lý bị hủy nên chưa ghi kết quả: dấu "đã gửi" còn nguyên.
    let row = await attemptRow(id);
    expect(row).toMatchObject({ status: 'processing', phase: 'submitted_awaiting_response' });
    expect(world.gateway.platformPosts).toHaveLength(1);

    world.gateway.onSubmit = undefined;
    world.clock.offsetMs = 3 * MIN;
    await world.run(id, account);
    row = await attemptRow(id);
    expect(row.status).toBe('succeeded');
    expect(world.gateway.submitCalls).toBe(1);
    expect(world.gateway.platformPosts).toHaveLength(1);
  });

  it('submit ném lỗi bất ngờ SAU khi ghi dấu → không xác định (đối soát), không gửi lại', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.script = ['throw'];
    await world.run(id, account);
    expect((await attemptRow(id)).status).toBe('unknown');
    await world.run(id, account);
    expect(world.gateway.submitCalls).toBe(1);
  });

  it('chạy lại nhiều lần mọi giai đoạn không bao giờ tạo bài thứ hai', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    for (let i = 0; i < 4; i++) await world.run(id, account);
    expect(world.gateway.platformPosts).toHaveLength(1);
    expect(world.gateway.submitCalls).toBe(1);
  });

  it('CSDL từ chối lượt `submitted_awaiting_response` thiếu dấu nội dung', async () => {
    await expect(
      seedAttempt(account, postId, connectionId, {
        status: 'processing',
        phase: 'submitted_awaiting_response',
      }),
    ).rejects.toThrow(/submitted_stamp/);
  });
});
