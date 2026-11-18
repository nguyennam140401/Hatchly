// US7 + vận hành (013) – ngắt kênh/xóa tài khoản không gửi thêm bài, việc hết lượt thử không gửi lại, bộ quét chỉ đo.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { tenantTx } from '../../../src/core/db/transaction';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { createFinalFailureHandler } from '../../../src/modules/publishing/internal/executor/execute-attempt.handler';
import { runSweepOverdue } from '../../../src/modules/publishing/internal/overdue.sweeper';
import { PublishingService } from '../../../src/modules/publishing/internal/publishing.service';
import { enqueue } from '../../../src/modules/queue';
import { runAttemptDedupeKey, runAttemptJob } from '../../../src/modules/publishing/jobs';
import type { ContentPublicApi } from '../../../src/modules/content';
import type { PlatformGatewayPublicApi } from '../../../src/modules/platform_gateway';
import { startTestProducer } from '../../support/queue-test-kit';
import {
  createAccount,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  withAccount,
  type TestDatabase,
} from '../helpers/queue-db';
import { attemptRow, makeWorld, seedAttempt, type World } from './harness';

describeDb('Vòng đời lượt đăng: ngắt kênh, việc hết lượt, bộ quét', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let account: string;
  let postId: string;
  let connectionId: string;
  let world: World;
  let service: PublishingService;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 5 });
    stopProducer = await startTestProducer();
    service = new PublishingService({} as ContentPublicApi, {} as PlatformGatewayPublicApi);
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

  const queued = async (id: string) =>
    withAccount(account, () =>
      tenantTx(() =>
        enqueue(runAttemptJob, { attemptId: id }, { dedupeKey: runAttemptDedupeKey(id) }),
      ),
    );

  it('cancelAllForConnection: hủy lượt scheduled + retry_wait và việc của chúng; lượt đang xử lý giữ nguyên', async () => {
    const a = await seedAttempt(account, postId, connectionId);
    const b = await seedAttempt(account, uuidV7(), connectionId, { status: 'retry_wait' });
    const c = await seedAttempt(account, uuidV7(), connectionId, { status: 'processing' });
    const other = await seedAttempt(account, uuidV7(), uuidV7());
    await queued(a);
    await queued(b);
    await queued(other);

    const res = await withAccount(account, () =>
      tenantTx((db) => service.cancelAllForConnection(db, connectionId)),
    );
    expect(res).toEqual({ cancelled: 2 });
    expect((await attemptRow(a)).status).toBe('cancelled');
    expect((await attemptRow(b)).status).toBe('cancelled');
    expect((await attemptRow(c)).status).toBe('processing'); // đang gửi: không hủy giữa chừng
    expect((await attemptRow(other)).status).toBe('scheduled');
    const open = await jobs("name = 'publish' AND state IN ('created','retry')");
    expect(open.map((j) => j.singleton_key)).toEqual([runAttemptDedupeKey(other)]);

    // Bộ xử lý nếu vẫn nhận được việc cũ thì bỏ qua – không gửi bài nào.
    await world.run(a, account);
    expect(world.gateway.submitCalls).toBe(0);
  });

  it('việc publish hết lượt thử + ĐÃ ghi dấu gửi → "Cần kiểm tra", KHÔNG gửi lại', async () => {
    const id = await seedAttempt(account, postId, connectionId, {
      status: 'processing',
      phase: 'submitted_awaiting_response',
      extra: { run_no: 1, content_hash: 'ch1:x', submitted_at: new Date() },
    });
    const onFinal = createFinalFailureHandler(world.deps);
    await withAccount(account, () => onFinal({ attemptId: id }));
    expect(await attemptRow(id)).toMatchObject({
      status: 'needs_check',
      needs_reason: 'uncertain_result',
    });
    expect(world.emitted).toHaveLength(1);
    expect(world.gateway.submitCalls).toBe(0);
  });

  it('việc hết lượt thử khi CHƯA gửi gì → "Cần người dùng" để họ bấm "Đăng lại"', async () => {
    const id = await seedAttempt(account, postId, connectionId, {
      status: 'retry_wait',
      extra: { run_no: 1, transient_attempts: 2 },
    });
    const onFinal = createFinalFailureHandler(world.deps);
    await withAccount(account, () => onFinal({ attemptId: id }));
    expect(await attemptRow(id)).toMatchObject({ status: 'needs_user', needs_reason: 'other' });
    // Lượt đã ở trạng thái chờ người dùng thì gọi lại không đổi gì.
    await withAccount(account, () => onFinal({ attemptId: id }));
    expect(world.emitted).toHaveLength(1);
  });

  it('bộ quét quá hạn: đếm số liệu tổng hợp, KHÔNG đổi trạng thái, KHÔNG gửi bài', async () => {
    const overdue = await seedAttempt(account, postId, connectionId, {
      scheduledAt: new Date(Date.now() - 20 * 60_000),
    });
    await seedAttempt(account, uuidV7(), connectionId, {
      scheduledAt: new Date(Date.now() + 3_600_000),
    });
    await seedAttempt(account, uuidV7(), connectionId, {
      status: 'unknown',
      phase: 'submitted_awaiting_response',
      extra: { content_hash: 'ch1:x', submitted_at: new Date() },
    });
    await seedAttempt(account, uuidV7(), connectionId, {
      status: 'needs_check',
      extra: { needs_reason: 'uncertain_result' },
    });
    const stats = await runSweepOverdue();
    expect(stats.overdueScheduled).toBeGreaterThanOrEqual(1);
    expect(stats.unknown).toBeGreaterThanOrEqual(1);
    expect(stats.needsCheck).toBeGreaterThanOrEqual(1);
    expect((await attemptRow(overdue)).status).toBe('scheduled');
    expect(world.gateway.submitCalls).toBe(0);
    // Chạy lại cho cùng kết quả (idempotent).
    expect(await runSweepOverdue()).toEqual(stats);
  });
});
