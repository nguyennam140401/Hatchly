// 015 US8 T064 (FR-034, SC-013, hiến chương V): hai việc định kỳ cảnh báo vận hành của Cổng AI chạy qua hàng chờ THẬT
// (pg-boss + Worker): `ai_gateway.check_thresholds` (mỗi 5 phút, SC-013) và `ai_gateway.reconcile_invoices` (02:00 UTC+7 hằng ngày).
// Viết TRƯỚC mã (T066/T067): ĐỎ tạm vì chưa có `checkThresholdsJob` / `reconcileInvoicesJob` / lịch trong `ai_gateway/jobs.ts`.
// Giao ước (xem thêm test/ai_gateway/alerts.db.spec.ts): hai việc hàng chờ `scheduled`, phạm vi hệ thống, payload `{}`, khóa
// chống trùng do bộ lập lịch đặt `scheduled:<tên việc>` (khung tính theo `infra.schedule_slots`), bộ xử lý đăng ký trong
// `registerAiJobHandlers`, lịch khai báo bằng `defineAlertSchedules()` (xuất khẩu từ `jobs.ts`, gọi lại nhiều lần an toàn).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { systemTx } from '../../src/core/db/transaction';
import * as aiJobs from '../../src/modules/ai_gateway/jobs';
import { enqueue } from '../../src/modules/queue';
import { listSchedules } from '../../src/modules/queue/schedules';
import {
  cleanupProvider,
  captureGatewayLog,
  reconcileDate,
  seedLedger,
  setInvoice,
  shapeAtLeast,
  shapeAtMost,
  signature,
  uniqueProvider,
  type EventCapture,
} from '../ai_gateway/helpers/alerts-fixtures';
import { makeDbStore } from '../contracts/ai/harness';
import { startTestProducer, startTestWorkers } from '../support/queue-test-kit';
import { describeDb, jobs, makeDatabase, resetQueues, type TestDatabase } from './helpers/queue-db';

const { checkThresholdsJob, reconcileInvoicesJob, registerAiJobHandlers } = aiJobs;

const THRESHOLD = 'ai.threshold_ratio_high';
const MISMATCH = 'ai.invoice_mismatch';

describeDb('Việc cảnh báo vận hành Cổng AI qua hàng chờ (US8)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let log: EventCapture;
  const cleanups: (() => Promise<void>)[] = [];
  const providers: string[] = [];

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    stopProducer = await startTestProducer();
    await resetQueues();
    registerAiJobHandlers(await makeDbStore());
    // Lịch khai báo (idempotent); nếu T066/T067 khai báo lịch ngay khi nạp mô-đun thì hàm này không bắt buộc – hai cách đều qua.
    (aiJobs as { defineAlertSchedules?: () => void }).defineAlertSchedules?.();
    log = captureGatewayLog();
  });
  afterEach(async () => {
    for (const fn of cleanups.splice(0)) await fn();
    for (const p of providers.splice(0)) await cleanupProvider(p);
    log.clear();
  });
  afterAll(async () => {
    log.stop();
    await stopProducer();
    await database.close();
  });

  /** Xếp việc như bộ lập lịch: trong giao dịch hệ thống, khóa chống trùng `scheduled:<tên việc>`. */
  type ScheduledDef = typeof checkThresholdsJob;
  const enqueueScheduled = (def: ScheduledDef) =>
    systemTx(() => enqueue(def, {}, { dedupeKey: `scheduled:${def.name}` }));

  /** Đưa việc vào hàng `scheduled` (khóa chống trùng như bộ lập lịch) rồi chạy Worker thật tới khi hàng rỗng. */
  async function runViaWorker(def: ScheduledDef): Promise<void> {
    const queued = await enqueueScheduled(def);
    expect(queued.status).toBe('created');
    const workers = await startTestWorkers(1, { queues: ['scheduled'] });
    try {
      await workers.drain();
    } finally {
      await workers.stop();
    }
  }

  describe('khai báo việc và lịch', () => {
    it('hai loại việc: hàng chờ scheduled, phạm vi hệ thống, tên đúng hợp đồng', () => {
      expect(checkThresholdsJob).toMatchObject({
        name: 'ai_gateway.check_thresholds',
        queue: 'scheduled',
        scope: 'system',
      });
      expect(reconcileInvoicesJob).toMatchObject({
        name: 'ai_gateway.reconcile_invoices',
        queue: 'scheduled',
        scope: 'system',
      });
    });

    it('check_thresholds chạy mỗi 5 phút; reconcile_invoices chạy hằng ngày lúc 02:00 UTC+7 (= 19:00 UTC hôm trước)', () => {
      const threshold = listSchedules().filter((s) => s.name === 'ai_gateway.check_thresholds');
      const reconcile = listSchedules().filter((s) => s.name === 'ai_gateway.reconcile_invoices');
      expect(threshold).toHaveLength(1);
      expect(reconcile).toHaveLength(1);
      expect(threshold[0]!.cron).toBe('*/5 * * * *');
      expect(threshold[0]!.jobType.name).toBe('ai_gateway.check_thresholds');
      const r = reconcile[0]!;
      const viaVietnamTime = r.tz === 'Asia/Ho_Chi_Minh' && r.cron === '0 2 * * *';
      const viaUtc = r.tz === 'UTC' && r.cron === '0 19 * * *';
      expect(viaVietnamTime || viaUtc, `cron=${r.cron} tz=${r.tz}`).toBe(true);
      expect(r.jobType.name).toBe('ai_gateway.reconcile_invoices');
    });

    it('đồng thời 1: một lần chạy còn chờ/đang chạy thì khung trùng khóa bị bỏ (không tạo việc thứ hai)', async () => {
      await resetQueues();
      const first = await enqueueScheduled(checkThresholdsJob);
      const second = await enqueueScheduled(checkThresholdsJob);
      expect(first.status).toBe('created');
      expect(second.status).not.toBe('created');
      expect(await jobs("data->>'type' = 'ai_gateway.check_thresholds'")).toHaveLength(1);
      await resetQueues();
    });
  });

  describe('check_thresholds qua Worker thật', () => {
    it('6% tài khoản chạm ngưỡng → một cảnh báo; chạy lại lần hai cho cùng kết quả; không tạo thông báo cho khách', async () => {
      await resetQueues();
      cleanups.push(await shapeAtLeast(6));
      const notificationsBefore = (await jobs("data->>'type' = 'notifications.deliver'")).length;

      await runViaWorker(checkThresholdsJob);
      const first = log.named(THRESHOLD);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ level: 'warn', scope: 'system' });
      expect(first[0]!.account_id).toBeUndefined();

      log.clear();
      await runViaWorker(checkThresholdsJob);
      expect(signature(log.named(THRESHOLD))).toEqual(signature(first));

      // Cảnh báo là nhật ký + chỉ số vận hành nội bộ: tuyệt đối không phát thông báo cho khách hàng.
      expect((await jobs("data->>'type' = 'notifications.deliver'")).length).toBe(
        notificationsBefore,
      );
    });

    it('4% → việc chạy xong, không cảnh báo', async () => {
      await resetQueues();
      cleanups.push(await shapeAtMost(4));
      await runViaWorker(checkThresholdsJob);
      expect(log.named(THRESHOLD)).toEqual([]);
      // Việc đã chạy hết (không treo, không vào hàng chết).
      expect(
        await jobs("data->>'type' = 'ai_gateway.check_thresholds' AND state <> 'completed'"),
      ).toEqual([]);
    });
  });

  describe('reconcile_invoices qua Worker thật', () => {
    it('hóa đơn lệch 6% → cảnh báo nêu nhà cung cấp, ngày, mức lệch; chạy lại lần hai cùng kết quả', async () => {
      await resetQueues();
      const provider = uniqueProvider();
      providers.push(provider);
      const day = await reconcileDate();
      await seedLedger(provider, day, [1_060_000]);
      await setInvoice(provider, day, 1_000_000);

      await runViaWorker(reconcileInvoicesJob);
      const first = log.named(MISMATCH).filter((e) => e.provider === provider);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ level: 'warn', scope: 'system', invoice_date: day });
      expect(first[0]!.deviation_pct as number).toBeCloseTo(6, 1);
      expect(first[0]!.account_id).toBeUndefined();

      log.clear();
      await runViaWorker(reconcileInvoicesJob);
      const second = log.named(MISMATCH).filter((e) => e.provider === provider);
      expect(signature(second)).toEqual(signature(first));
    });

    it('thiếu hóa đơn → việc vẫn thành công, không cảnh báo giả', async () => {
      await resetQueues();
      const provider = uniqueProvider();
      providers.push(provider);
      await seedLedger(provider, await reconcileDate(), [3_000_000]);
      await runViaWorker(reconcileInvoicesJob);
      expect(log.named(MISMATCH).filter((e) => e.provider === provider)).toEqual([]);
      expect(
        await jobs("data->>'type' = 'ai_gateway.reconcile_invoices' AND state <> 'completed'"),
      ).toEqual([]);
    });
  });
});
