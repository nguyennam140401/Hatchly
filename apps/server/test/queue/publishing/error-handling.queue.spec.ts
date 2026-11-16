// US3 (013) – ba loại lỗi: "chắc chắn chưa nhận" tự thử lại có giãn cách (≤ 5 lần/30 phút, không báo người dùng);
// "cần người dùng" dừng + thông báo kèm cách sửa; "không xác định" KHÔNG gửi lại ngay (đối soát).
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { startTestProducer } from '../../support/queue-test-kit';
import { createAccount, describeDb, makeDatabase, type TestDatabase } from '../helpers/queue-db';
import { attemptRow, err, makeWorld, seedAttempt, stepRows, type World } from './harness';

const HOUR = 3_600_000;

describeDb('Xử lý lỗi khi đăng (US3)', () => {
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

  it('S5: lỗi tạm thời 2 lần rồi đăng được → retry_wait, KHÔNG thông báo, cuối cùng succeeded', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.script = ['timeout_before_publish', 'timeout_before_publish', 'published'];

    const r1 = await world.run(id, account);
    expect(r1).toMatchObject({ kind: 'retry_after', seconds: 60 });
    let row = await attemptRow(id);
    expect(row).toMatchObject({ status: 'retry_wait', transient_attempts: 1, phase: 'none' });
    expect(row.content_hash).toBeNull(); // dấu đã gửi bị xóa vì "chắc chắn chưa nhận"

    const r2 = await world.run(id, account);
    expect(r2).toMatchObject({ kind: 'retry_after', seconds: 180 });
    expect((await attemptRow(id)).transient_attempts).toBe(2);

    await world.run(id, account);
    row = await attemptRow(id);
    expect(row).toMatchObject({ status: 'succeeded', run_no: 3 });
    expect(world.emitted).toHaveLength(0);
    expect(world.gateway.platformPosts).toHaveLength(1);
  });

  it('S6: lỗi tạm thời liên tục → sau 5 lần chuyển needs_user (retries_exhausted) + thông báo', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.script = Array.from({ length: 6 }, () => 'timeout_before_publish' as const);
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await world.run(id, account);
      delays.push((r as { seconds: number }).seconds);
    }
    expect(delays).toEqual([60, 180, 360, 600, 600]);
    expect((await attemptRow(id)).transient_attempts).toBe(5);
    expect(world.emitted).toHaveLength(0);

    await world.run(id, account);
    const row = await attemptRow(id);
    expect(row).toMatchObject({ status: 'needs_user', needs_reason: 'retries_exhausted' });
    expect(world.emitted).toHaveLength(1);
    expect(world.emitted[0]).toMatchObject({
      type: 'publish_needs_action',
      refs: { attemptId: id, state: 'needs_user', reason: 'retries_exhausted' },
    });
    expect(world.gateway.platformPosts).toHaveLength(0);
  });

  it('S7: quyền hết hạn (cần người dùng) → dừng NGAY, thông báo kèm cách sửa, không thử lại', async () => {
    world.mappings.push({
      channelType: 'test_channel',
      rawCode: 'FB:190',
      category: 'user_action',
      messageVi: 'Quyền đăng bài đã hết hạn. Hãy kết nối lại.',
      remedies: [{ action: 'reconnect', labelVi: 'Kết nối lại' }],
      needsReason: 'token_expired',
      retryAfterSec: null,
    });
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.script = [{ fail: err('unknown', 'FB:190') }];
    await world.run(id, account);

    const row = await attemptRow(id);
    expect(row).toMatchObject({ status: 'needs_user', needs_reason: 'token_expired' });
    expect(world.emitted[0]).toMatchObject({
      refs: { state: 'needs_user', reason: 'token_expired' },
    });
    const failed = (await stepRows(id)).find((s) => s.outcome === 'failed');
    expect(failed).toMatchObject({
      step_key: 'submit',
      error_category: 'user_action',
      raw_code: 'FB:190',
    });
    expect(failed?.remedies).toEqual([{ action: 'reconnect', labelVi: 'Kết nối lại' }]);
    // Bước sau bước lỗi được ghi "chưa chạy".
    const skipped = (await stepRows(id))
      .filter((s) => s.outcome === 'skipped')
      .map((s) => s.step_key);
    expect(skipped).toEqual(['await_processing', 'confirm']);
    // Chạy lại không đổi gì (needs_user là trạng thái chờ người dùng).
    expect(await world.run(id, account)).toBeUndefined();
    expect(world.gateway.submitCalls).toBe(1);
  });

  it('S8: mã lỗi lạ → unknown, KHÔNG gửi lần hai; không bao giờ đoán là tạm thời', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.script = [{ fail: err('unknown', 'ZZZ:1') }];
    const r = await world.run(id, account);
    expect(r).toMatchObject({ kind: 'retry_after' });
    expect(await attemptRow(id)).toMatchObject({ status: 'unknown', transient_attempts: 0 });
    await world.run(id, account);
    expect(world.gateway.submitCalls).toBe(1);
    expect(world.emitted).toHaveLength(0);
  });

  it('dòng ánh xạ thay thông điệp/cách khắc phục mà không cần phát hành (US3-6)', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.script = [{ fail: err('unknown', 'NEW:7') }];
    world.mappings.push({
      channelType: 'test_channel',
      rawCode: 'NEW:7',
      category: 'user_action',
      messageVi: 'Thông điệp mới từ bảng ánh xạ.',
      remedies: [{ action: 'edit_text', labelVi: 'Sửa nội dung' }],
      needsReason: 'other',
      retryAfterSec: null,
    });
    await world.run(id, account);
    expect((await attemptRow(id)).status).toBe('needs_user');
    const failed = (await stepRows(id)).find((s) => s.outcome === 'failed');
    expect(failed?.remedies).toEqual([{ action: 'edit_text', labelVi: 'Sửa nội dung' }]);
  });

  it('gói hết hạn → needs_user plan_expired ở bước 1, không gọi nền tảng', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.eligibility.planActive = false;
    await world.run(id, account);
    expect(await attemptRow(id)).toMatchObject({
      status: 'needs_user',
      needs_reason: 'plan_expired',
    });
    expect(world.gateway.submitCalls).toBe(0);
    expect(world.emitted).toHaveLength(1);
  });

  it('tài khoản đang bị xóa → lượt bị hủy, không đăng', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.eligibility.deletionRequested = true;
    await world.run(id, account);
    expect((await attemptRow(id)).status).toBe('cancelled');
    expect(world.gateway.submitCalls).toBe(0);
  });

  it('kênh bị ngắt hoặc hết hạn quyền → needs_user kèm "Kết nối lại"', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.connectionStatus = 'disconnected';
    await world.run(id, account);
    expect(await attemptRow(id)).toMatchObject({
      status: 'needs_user',
      needs_reason: 'token_expired',
    });
    const failed = (await stepRows(id)).find((s) => s.outcome === 'failed');
    expect(failed?.step_key).toBe('precheck');
    expect((failed?.remedies as { action: string }[])[0]?.action).toBe('reconnect');
  });

  it('tài khoản kênh không đủ điều kiện (vd Instagram không chuyên nghiệp) → needs_user, không gửi', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.eligible = false;
    world.mappings.push({
      channelType: 'test_channel',
      rawCode: 'IG:NOT_PROFESSIONAL',
      category: 'user_action',
      messageVi: 'Cần tài khoản chuyên nghiệp.',
      remedies: [{ action: 'reconnect', labelVi: 'Kết nối lại' }],
      needsReason: 'not_professional_account',
      retryAfterSec: null,
    });
    await world.run(id, account);
    expect(await attemptRow(id)).toMatchObject({
      status: 'needs_user',
      needs_reason: 'not_professional_account',
    });
    expect(world.gateway.submitCalls).toBe(0);
  });

  it('Instagram bài không có media → chặn ở bước 1 với thông báo rõ (S16)', async () => {
    const id = await seedAttempt(account, postId, connectionId, { channelType: 'instagram' });
    await world.run(id, account);
    expect(await attemptRow(id)).toMatchObject({
      status: 'needs_user',
      needs_reason: 'media_invalid',
    });
    expect(world.gateway.submitCalls).toBe(0);
  });

  it('hạn mức đăng trong ngày hết → needs_user rate_limited_daily, gợi ý chọn giờ khác', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    world.gateway.quotaRemaining = 0;
    await world.run(id, account);
    expect(await attemptRow(id)).toMatchObject({
      status: 'needs_user',
      needs_reason: 'rate_limited_daily',
    });
  });

  it('media không lấy được → needs_user media_invalid ở bước 2, bước 1 đã đạt', async () => {
    const id = await seedAttempt(account, postId, connectionId);
    const m = world.post.variants[0];
    if (m) m.media = [{ mediaId: uuidV7(), kind: 'image' }];
    world.media.result = { kind: 'unavailable', mediaIds: [] };
    await world.run(id, account);
    expect(await attemptRow(id)).toMatchObject({
      status: 'needs_user',
      needs_reason: 'media_invalid',
    });
    const rows = await stepRows(id);
    expect(rows.find((s) => s.step_key === 'precheck' && s.event === 'finished')?.outcome).toBe(
      'succeeded',
    );
    expect(
      rows.find((s) => s.step_key === 'prepare_media' && s.outcome === 'failed'),
    ).toBeDefined();
    expect(world.gateway.submitCalls).toBe(0);
  });

  it('quá giờ hẹn > 60 phút ở lần bắt đầu đầu tiên → needs_user overdue, KHÔNG đăng (S14)', async () => {
    const id = await seedAttempt(account, postId, connectionId, {
      scheduledAt: new Date(Date.now() - 2 * HOUR),
    });
    await world.run(id, account);
    expect(await attemptRow(id)).toMatchObject({ status: 'needs_user', needs_reason: 'overdue' });
    expect(world.gateway.submitCalls).toBe(0);
    expect(world.emitted[0]).toMatchObject({ refs: { reason: 'overdue' } });
  });

  it('đăng muộn ≤ 60 phút vẫn đăng đúng một lần', async () => {
    const id = await seedAttempt(account, postId, connectionId, {
      scheduledAt: new Date(Date.now() - 30 * 60_000),
    });
    await world.run(id, account);
    expect((await attemptRow(id)).status).toBe('succeeded');
    expect(world.gateway.platformPosts).toHaveLength(1);
  });

  it('ngưỡng quá giờ KHÔNG áp dụng cho lượt thử lại (retry_wait) đã bắt đầu từ trước', async () => {
    const id = await seedAttempt(account, postId, connectionId, {
      status: 'retry_wait',
      scheduledAt: new Date(Date.now() - 3 * HOUR),
      extra: { run_no: 1, transient_attempts: 1 },
    });
    await world.run(id, account);
    expect((await attemptRow(id)).status).toBe('succeeded');
  });
});
