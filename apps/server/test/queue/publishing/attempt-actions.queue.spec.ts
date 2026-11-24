// US2/US4 (013) – "Đăng lại" và "Đã đăng": khóa lạc quan, hai yêu cầu đồng thời chỉ MỘT thắng và chỉ MỘT việc được tạo,
// kênh đã đăng không đăng lại được, "Đã đăng" chỉ từ "Cần kiểm tra" và không gọi nền tảng; ghi kiểm toán.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { runWithJobContext } from '../../../src/core/context/bind-account';
import { tenantTx } from '../../../src/core/db/transaction';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { AttemptActionsService } from '../../../src/modules/publishing/internal/attempt-actions.service';
import { runAttemptDedupeKey, runAttemptJob } from '../../../src/modules/publishing/jobs';
import { enqueue } from '../../../src/modules/queue';
import { startTestProducer } from '../../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  withAccount,
  type TestDatabase,
} from '../helpers/queue-db';
import { attemptRow, makeWorld, seedAttempt, type World } from './harness';

describeDb('Hành động của người dùng trên lượt đăng', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let account: string;
  let postId: string;
  let connectionId: string;
  let world: World;
  const service = new AttemptActionsService();
  const user = uuidV7();

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 6 });
    stopProducer = await startTestProducer();
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });
  beforeEach(async () => {
    await resetQueues();
    account = await createAccount();
    postId = uuidV7();
    connectionId = uuidV7();
    world = makeWorld(postId, connectionId);
    world.register();
  });

  const needsUser = (extra: Record<string, unknown> = {}, scheduledAt?: Date) =>
    seedAttempt(account, postId, connectionId, {
      status: 'needs_user',
      ...(scheduledAt ? { scheduledAt } : {}),
      extra: { run_no: 1, needs_reason: 'token_expired', ...extra },
    });
  const republish = (id: string, version: number) =>
    withAccount(account, () => service.republish(id, version, user));

  it('Đăng lại từ needs_user: về scheduled, giờ = bây giờ, xóa dấu, tạo ĐÚNG MỘT việc khóa publish:{id}', async () => {
    const id = await needsUser({}, new Date(Date.now() - 3 * 3_600_000));
    const before = await attemptRow(id);
    const res = await republish(id, before.version);
    expect(res).toEqual({ attemptId: id, status: 'scheduled' });

    const row = await attemptRow(id);
    expect(row).toMatchObject({
      status: 'scheduled',
      phase: 'none',
      needs_reason: null,
      content_hash: null,
      submitted_at: null,
    });
    const created = await jobs("name = 'publish' AND singleton_key = $1", [`publish:${id}`]);
    expect(created).toHaveLength(1);

    // Bộ xử lý chạy tiếp được (giờ đã đặt lại nên không quá hạn) và đăng đúng một bài.
    await world.run(id, account);
    expect((await attemptRow(id)).status).toBe('succeeded');
    expect(world.gateway.platformPosts).toHaveLength(1);
  });

  it('hai yêu cầu "Đăng lại" đồng thời → đúng MỘT thành công, một lỗi 409, chỉ một việc', async () => {
    const id = await needsUser();
    const v = (await attemptRow(id)).version;
    const results = await Promise.allSettled([republish(id, v), republish(id, v)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected')!;
    expect(['PUBLISH_NOT_REPUBLISHABLE', 'PUBLISH_VERSION_CONFLICT']).toContain(
      (rejected.reason as { code: string }).code,
    );
    expect(await jobs("name = 'publish' AND singleton_key = $1", [`publish:${id}`])).toHaveLength(
      1,
    );
  });

  it('phiên bản lệch → PUBLISH_VERSION_CONFLICT, không đổi gì', async () => {
    const id = await needsUser();
    const v = (await attemptRow(id)).version;
    await expect(republish(id, v + 5)).rejects.toMatchObject({ code: 'PUBLISH_VERSION_CONFLICT' });
    expect((await attemptRow(id)).status).toBe('needs_user');
  });

  it.each(['processing', 'succeeded', 'retry_wait', 'scheduled'] as const)(
    'lượt %s KHÔNG đăng lại được (PUBLISH_NOT_REPUBLISHABLE)',
    async (status) => {
      const id = await seedAttempt(account, postId, connectionId, {
        status,
        ...(status === 'succeeded' ? { phase: 'finished' } : {}),
        extra: status === 'succeeded' ? { platform_post_id: 'p1' } : {},
      });
      const v = (await attemptRow(id)).version;
      await expect(republish(id, v)).rejects.toMatchObject({ code: 'PUBLISH_NOT_REPUBLISHABLE' });
      expect(await jobs("name = 'publish' AND singleton_key = $1", [`publish:${id}`])).toHaveLength(
        0,
      );
    },
  );

  it('Đăng lại từ needs_check có cảnh báo nguy cơ đăng trùng', async () => {
    const id = await seedAttempt(account, postId, connectionId, {
      status: 'needs_check',
      extra: { needs_reason: 'uncertain_result', run_no: 1 },
    });
    const res = await republish(id, (await attemptRow(id)).version);
    expect(res.warning).toBe('possible_duplicate');
  });

  it('"Đã đăng": chỉ từ needs_check, confirmed_by = user, KHÔNG gọi nền tảng, ghi kiểm toán', async () => {
    const id = await seedAttempt(account, postId, connectionId, {
      status: 'needs_check',
      extra: { needs_reason: 'uncertain_result', run_no: 1 },
    });
    const v = (await attemptRow(id)).version;
    const res = await withAccount(account, () =>
      service.markPublished(id, v, 'https://facebook.com/post/1', user),
    );
    expect(res).toMatchObject({ status: 'published', permalink: 'https://facebook.com/post/1' });
    expect(await attemptRow(id)).toMatchObject({
      status: 'succeeded',
      phase: 'finished',
      confirmed_by: 'user',
      needs_reason: null,
    });
    expect(world.gateway.submitCalls).toBe(0);
    const audit = await asOwner((c) =>
      c.query<{ action: string; metadata: Record<string, unknown> }>(
        "SELECT action, metadata FROM infra.audit_log WHERE account_id = $1 AND action = 'publish.mark_published'",
        [account],
      ),
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0]?.metadata)).not.toMatch(/token|text|content/i);
  });

  it('"Đã đăng" từ trạng thái khác → PUBLISH_NOT_CHECKABLE; kênh đã đăng không có đường "Đăng lại"', async () => {
    const id = await needsUser();
    const v = (await attemptRow(id)).version;
    await expect(
      withAccount(account, () => service.markPublished(id, v, undefined, user)),
    ).rejects.toMatchObject({ code: 'PUBLISH_NOT_CHECKABLE' });
  });

  it('tài khoản khác không thấy/không đổi được lượt (RLS → 404)', async () => {
    const other = await createAccount();
    const id = await needsUser();
    const v = (await attemptRow(id)).version;
    await expect(withAccount(other, () => service.republish(id, v, user))).rejects.toMatchObject({
      code: 'PUBLISH_ATTEMPT_NOT_FOUND',
    });
    await expect(withAccount(other, () => service.supportDetails(id))).rejects.toMatchObject({
      code: 'PUBLISH_ATTEMPT_NOT_FOUND',
    });
    expect((await attemptRow(id)).status).toBe('needs_user');
  });

  it('chi tiết cho hỗ trợ: mã gốc đã lọc + mã theo dõi, không trạng thái nội bộ', async () => {
    const id = await needsUser({ last_raw_code: 'FB:190', last_error_category: 'user_action' });
    const details = await withAccount(account, () => service.supportDetails(id));
    expect(details).toMatchObject({
      attemptId: id,
      rawCode: 'FB:190',
      errorCategoryLabel: 'Cần người dùng xử lý',
      runNo: 1,
    });
    expect(Object.keys(details)).not.toContain('internalStatus');
    expect(details.traceId).toMatch(/^[0-9a-f-]+$/);
  });

  // T087 (M1) – khóa `publish:{id}` còn việc hiệu lực → `enqueue` trả `exists` → Đăng lại PHẢI từ chối và hoàn tác
  // toàn bộ giao dịch (không để lượt ở `scheduled` mà không có việc – Hiến pháp V).
  it.each([
    ['needs_user', { needs_reason: 'token_expired' }],
    ['needs_check', { needs_reason: 'uncertain_result' }],
  ] as const)(
    'khóa publish:{id} còn việc (enqueue = exists) → Đăng lại từ %s bị từ chối PUBLISH_VERSION_CONFLICT và hoàn tác toàn bộ',
    async (status, reason) => {
      const submittedAt = new Date(Date.now() - 600_000);
      const id = await seedAttempt(account, postId, connectionId, {
        status,
        extra: { run_no: 2, content_hash: 'ch1:abc', submitted_at: submittedAt, ...reason },
      });
      // Việc đang hiệu lực giữ khóa chống trùng (cùng khóa mà Đăng lại sẽ dùng).
      await withAccount(account, () =>
        tenantTx(() =>
          enqueue(
            runAttemptJob,
            { attemptId: id },
            { runAfter: new Date(), dedupeKey: runAttemptDedupeKey(id) },
          ),
        ),
      );
      const key = `publish:${id}`;
      const jobsBefore = await jobs("name = 'publish' AND singleton_key = $1", [key]);
      expect(jobsBefore).toHaveLength(1);
      const before = await attemptRow(id);

      await expect(republish(id, before.version)).rejects.toMatchObject({
        code: 'PUBLISH_VERSION_CONFLICT',
        message: 'Bài đang được xử lý, thử lại sau ít giây',
      });

      // Lượt giữ nguyên MỌI trường quan trọng (kể cả version): giao dịch hoàn tác hoàn toàn.
      expect(await attemptRow(id)).toEqual(before);
      expect(before).toMatchObject({
        status,
        run_no: 2,
        content_hash: 'ch1:abc',
        needs_reason: reason.needs_reason,
      });
      expect(before.submitted_at?.getTime()).toBe(submittedAt.getTime());
      // Không tạo việc mới: vẫn đúng MỘT việc (việc cũ).
      const jobsAfter = await jobs("name = 'publish' AND singleton_key = $1", [key]);
      expect(jobsAfter.map((j) => j.id)).toEqual(jobsBefore.map((j) => j.id));
      // Không ghi kiểm toán.
      const audit = await asOwner((c) =>
        c.query(
          "SELECT 1 FROM infra.audit_log WHERE account_id = $1 AND action = 'publish.republish'",
          [account],
        ),
      );
      expect(audit.rows).toHaveLength(0);
    },
  );

  // T089 (M2)
  it('Đăng lại: audit_log publish.republish có actor_id, trace_id, metadata chỉ chứa mã; scheduled_at ≈ now(); run_no không đổi', async () => {
    const id = await needsUser({ run_no: 3 }, new Date(Date.now() - 5 * 3_600_000));
    const v = (await attemptRow(id)).version;
    const traceId = uuidV7();
    const started = Date.now();
    await runWithJobContext({ traceId, accountId: account }, () => service.republish(id, v, user));

    const row = await asOwner((c) =>
      c.query<{ scheduled_at: Date; run_no: number }>(
        'SELECT scheduled_at, run_no FROM publishing.publish_attempts WHERE id = $1',
        [id],
      ),
    );
    // Giờ đăng được đặt lại về "bây giờ" (không còn là 5 giờ trước).
    expect(Math.abs((row.rows[0]?.scheduled_at.getTime() ?? 0) - started)).toBeLessThan(15_000);
    // run_no chỉ tăng lúc chiếm lượt (scheduled → processing), KHÔNG tăng lúc Đăng lại.
    expect(row.rows[0]?.run_no).toBe(3);

    const audit = await asOwner((c) =>
      c.query<{
        actor_type: string;
        actor_id: string;
        trace_id: string;
        metadata: Record<string, unknown>;
      }>(
        "SELECT actor_type, actor_id, trace_id, metadata FROM infra.audit_log WHERE account_id = $1 AND action = 'publish.republish'",
        [account],
      ),
    );
    expect(audit.rows).toHaveLength(1);
    const entry = audit.rows[0]!;
    expect(entry.actor_type).toBe('user');
    expect(entry.actor_id).toBe(user);
    expect(entry.trace_id).toBe(traceId);
    // metadata CHỈ chứa mã tham chiếu/trạng thái, không nội dung bài hay mã quyền.
    expect(Object.keys(entry.metadata).sort()).toEqual(
      ['attemptId', 'fromStatus', 'postId', 'reason'].sort(),
    );
    expect(entry.metadata).toMatchObject({
      attemptId: id,
      postId,
      fromStatus: 'needs_user',
      reason: 'token_expired',
    });
    expect(JSON.stringify(entry.metadata)).not.toMatch(/token_value|secret|Nội dung đã duyệt/i);
  });

  it('lượt unknown (nội bộ) KHÔNG đăng lại được → PUBLISH_NOT_REPUBLISHABLE, không tạo việc', async () => {
    const id = await seedAttempt(account, postId, connectionId, {
      status: 'unknown',
      phase: 'submitted_awaiting_response',
      extra: { run_no: 1, content_hash: 'ch1:abc', submitted_at: new Date() },
    });
    const before = await attemptRow(id);
    await expect(republish(id, before.version)).rejects.toMatchObject({
      code: 'PUBLISH_NOT_REPUBLISHABLE',
    });
    expect(await attemptRow(id)).toEqual(before);
    expect(await jobs("name = 'publish' AND singleton_key = $1", [`publish:${id}`])).toHaveLength(
      0,
    );
  });
});
