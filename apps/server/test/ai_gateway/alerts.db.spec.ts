import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { GatewayLogEntry } from '../../src/core/gateways/op-log';
import {
  checkThresholdsJob,
  reconcileInvoicesJob,
  registerAiJobHandlers,
} from '../../src/modules/ai_gateway/jobs';
import { makeDbStore } from '../contracts/ai/harness';
import { describeDb, makeDatabase, type TestDatabase } from '../db/helpers/db';
import { runJobInline } from '../support/queue-test-kit';
import {
  addAccounts,
  addDays,
  captureGatewayLog,
  cleanupProvider,
  dataFingerprint,
  localToday,
  MONEY_OR_ACCOUNT_KEY,
  population,
  reconcileDate,
  seedLedger,
  setInvoice,
  shapeAtLeast,
  shapeAtMost,
  shapeExactlyFivePercent,
  signature,
  uniqueProvider,
  type EventCapture,
} from './helpers/alerts-fixtures';

// 015 US8 T064 (FR-034, SC-013, hiến chương V và VIII): cảnh báo vận hành của Cổng AI trên kho THẬT.
// Viết TRƯỚC mã (T066/T067): ĐỎ tạm vì chưa có `checkThresholdsJob` / `reconcileInvoicesJob` trong `modules/ai_gateway/jobs.ts`
// và bộ xử lý `internal/alerts/{threshold-check,invoice-reconcile}.ts` (mọi ca báo "chưa có bộ xử lý" hoặc thiếu export).
//
// Giao ước kiểm thử đặt cho T066/T067 (dev bám theo; nếu cần đổi, báo lại để cập nhật kiểm thử):
//  - Hai việc `ai_gateway.check_thresholds` / `ai_gateway.reconcile_invoices` (queue `scheduled`, scope `system`, payload `{}`)
//    xuất khẩu `checkThresholdsJob` / `reconcileInvoicesJob` ở `jobs.ts`; bộ xử lý đăng ký trong `registerAiJobHandlers`.
//  - check_thresholds: tử số = tài khoản có dòng ngân sách chu kỳ HIỆN HÀNH với used + reserved ≥ soft_limit; mẫu số = tài
//    khoản đang hoạt động (loại `unclaimed`). Cảnh báo CHỈ khi tử số / mẫu số > 5% (đúng 5% thì không).
//    Nhật ký `ai.threshold_ratio_high` mức `warn`, phạm vi hệ thống, không mang số tiền hay mã tài khoản.
//  - reconcile_invoices: đối soát NGÀY HÔM TRƯỚC theo giờ Việt Nam: Σ cost_micro_usd của sổ theo (nhà cung cấp, ngày) so với
//    `provider_invoices`; |Σ − hóa đơn| / hóa đơn > 5% (đúng 5% thì không) → nhật ký `ai.invoice_mismatch` mức `warn` với
//    `provider`, `invoice_date` (YYYY-MM-DD, chuỗi) và `deviation_pct` (số, phần trăm tuyệt đối, vd 6). Cần thêm hai khóa
//    `invoice_date`, `deviation_pct` vào danh sách an toàn của `core/gateways/op-log.ts` và `GatewayEventFields`.
//    Thiếu hóa đơn của (nhà cung cấp, ngày) → KHÔNG cảnh báo `warn`; ghi nhận mức `info` tên `ai.invoice_missing` (cùng
//    `provider`, `invoice_date`) để vận hành biết ngày đó chưa đối soát được. Hóa đơn có nhưng sổ không có dòng nào → Σ = 0
//    → lệch 100% → cảnh báo (mất sổ là điều vận hành cần biết).
//  - Cả hai chạy lại hai lần cho cùng kết quả: mỗi lần chạy phát cùng bộ nhật ký, không đổi dữ liệu.

const THRESHOLD = 'ai.threshold_ratio_high';
const MISMATCH = 'ai.invoice_mismatch';
const MISSING = 'ai.invoice_missing';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Mọi dòng cảnh báo vận hành: mức warn, phạm vi hệ thống, không số tiền/tài khoản nhận dạng được. */
function expectOperational(entry: GatewayLogEntry): void {
  expect(entry.level).toBe('warn');
  expect(entry.scope).toBe('system');
  expect(entry.account_id).toBeUndefined();
  const keys = Object.keys(entry).filter((k) => MONEY_OR_ACCOUNT_KEY.test(k));
  expect(keys, `khóa nhạy cảm: ${keys.join(',')}`).toEqual([]);
  expect(JSON.stringify(signature([entry]))).not.toMatch(UUID);
}

describeDb('Cổng AI – cảnh báo vận hành và đối soát (US8)', () => {
  let database: TestDatabase;
  let log: EventCapture;
  const cleanups: (() => Promise<void>)[] = [];
  const providers: string[] = [];

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    registerAiJobHandlers(await makeDbStore());
    log = captureGatewayLog();
  });
  afterEach(async () => {
    for (const fn of cleanups.splice(0)) await fn();
    for (const p of providers.splice(0)) await cleanupProvider(p);
    log.clear();
  });
  afterAll(async () => {
    log.stop();
    await database.close();
  });

  // ------------------------------------------------------------------------------------------------------------
  // check_thresholds
  // ------------------------------------------------------------------------------------------------------------
  describe('check_thresholds – tỷ lệ tài khoản chạm ngưỡng mềm 2 USD', () => {
    async function check(): Promise<GatewayLogEntry[]> {
      log.clear();
      await runJobInline(checkThresholdsJob, {});
      return log.named(THRESHOLD);
    }

    it('6% tài khoản hoạt động chạm ngưỡng → đúng MỘT cảnh báo ai.threshold_ratio_high, không số tiền/tài khoản', async () => {
      cleanups.push(await shapeAtLeast(6));
      const events = await check();
      expect(events).toHaveLength(1);
      expectOperational(events[0]!);
    });

    it('4% → không cảnh báo', async () => {
      cleanups.push(await shapeAtMost(4));
      expect(await check()).toEqual([]);
    });

    it('đúng 5% → không cảnh báo (quy tắc là "> 5%")', async (ctx) => {
      const undo = await shapeExactlyFivePercent();
      if (undo === null) return ctx.skip(); // hai cách đếm "tài khoản hoạt động" lệch nhau trong CSDL này
      cleanups.push(undo);
      expect(await check()).toEqual([]);
    });

    it('tài khoản chờ (unclaimed) không vào mẫu số: 6% trên tài khoản hoạt động, thêm nhiều tài khoản chờ vẫn cảnh báo', async () => {
      cleanups.push(await shapeAtLeast(6));
      // Nếu tài khoản chờ bị đếm vào mẫu số, tỷ lệ tụt xuống dưới 5% và cảnh báo biến mất (thêm ≥ 50% mẫu số hiện có).
      const { tMax } = await population();
      cleanups.push(
        await addAccounts({ soft: 0, plain: 0, unclaimed: Math.ceil(tMax * 0.5) + 10 }),
      );
      expect(await check()).toHaveLength(1);
    });

    it('chỉ tính dòng ngân sách của chu kỳ hiện hành: chu kỳ đã kết thúc, hoặc ngay dưới ngưỡng, không làm đủ 5%', async () => {
      cleanups.push(await shapeAtMost(4));
      // Nhiều tài khoản chỉ có ngân sách đạt ngưỡng ở chu kỳ CŨ (≥ 15% mẫu số) → nếu bị đếm, tỷ lệ vượt xa 5%.
      const { tMax } = await population();
      cleanups.push(
        await addAccounts({ soft: 0, plain: 0, staleSoft: Math.ceil(tMax * 0.15) + 10 }),
      );
      // Và nhiều tài khoản ngay dưới ngưỡng (soft − 1) không được tính là chạm ngưỡng.
      cleanups.push(await addAccounts({ soft: 0, plain: 800 }));
      expect(await check()).toEqual([]);
    });

    it('tính cả phần đang giữ chỗ: used + reserved ≥ soft_limit đủ để tính là chạm ngưỡng', async () => {
      // addAccounts xen kẽ tài khoản (used 2.000.000) và (used 1.000.000 + reserved 1.000.000): cả hai nhóm đều là "chạm".
      cleanups.push(await shapeAtLeast(6));
      const events = await check();
      expect(events).toHaveLength(1);
    });

    it('chạy lại hai lần cho cùng kết quả: cùng nhật ký mỗi lần, dữ liệu không đổi', async () => {
      cleanups.push(await shapeAtLeast(6));
      const before = await dataFingerprint();
      const first = await check();
      const second = await check();
      expect(first).toHaveLength(1);
      expect(signature(second)).toEqual(signature(first));
      expect(await dataFingerprint()).toEqual(before);

      cleanups.push(await shapeAtMost(4));
      // (sau khi thêm tài khoản dưới ngưỡng ở trên, ca "dưới 5%" cũng ổn định qua hai lần chạy) – không đảo trạng thái.
      const a = await check();
      const b = await check();
      expect(signature(b)).toEqual(signature(a));
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  // reconcile_invoices
  // ------------------------------------------------------------------------------------------------------------
  describe('reconcile_invoices – đối soát sổ chi phí với hóa đơn nhà cung cấp (ngày hôm trước, UTC+7)', () => {
    async function reconcile(): Promise<{
      mismatches: GatewayLogEntry[];
      notes: GatewayLogEntry[];
    }> {
      log.clear();
      await runJobInline(reconcileInvoicesJob, {});
      return { mismatches: log.named(MISMATCH), notes: log.named(MISSING) };
    }
    const mine = (entries: GatewayLogEntry[], provider: string) =>
      entries.filter((e) => e.provider === provider);
    const newProvider = () => {
      const p = uniqueProvider();
      providers.push(p);
      return p;
    };

    it('hóa đơn lệch 6% (sổ cao hơn) → đúng MỘT cảnh báo ai.invoice_mismatch nêu nhà cung cấp, ngày và mức lệch', async () => {
      const provider = newProvider();
      const day = await reconcileDate();
      const accountIds = await seedLedger(provider, day, [600_000, 460_000]); // Σ sổ = 1.060.000
      await setInvoice(provider, day, 1_000_000);

      const { mismatches } = await reconcile();
      const events = mine(mismatches, provider);
      expect(events).toHaveLength(1);
      const [e] = events;
      expectOperational(e!);
      expect(e).toMatchObject({ msg: MISMATCH, provider, invoice_date: day });
      expect(e!.deviation_pct as number).toBeCloseTo(6, 1);
      // Không lộ số liệu theo tài khoản: mã tài khoản trong sổ không xuất hiện.
      for (const id of accountIds) expect(JSON.stringify(e)).not.toContain(id);
    });

    it('sổ THẤP hơn hóa đơn 6% cũng cảnh báo (lệch hai chiều, mức lệch lấy giá trị tuyệt đối)', async () => {
      const provider = newProvider();
      const day = await reconcileDate();
      await seedLedger(provider, day, [940_000]);
      await setInvoice(provider, day, 1_000_000);
      const events = mine((await reconcile()).mismatches, provider);
      expect(events).toHaveLength(1);
      expect(events[0]!.deviation_pct as number).toBeCloseTo(6, 1);
    });

    it('lệch 4% và đúng 5% → không cảnh báo (quy tắc là "> 5%")', async () => {
      const a = newProvider();
      const b = newProvider();
      const day = await reconcileDate();
      await seedLedger(a, day, [1_040_000]);
      await setInvoice(a, day, 1_000_000);
      await seedLedger(b, day, [1_050_000]);
      await setInvoice(b, day, 1_000_000);
      const { mismatches } = await reconcile();
      expect(mine(mismatches, a)).toEqual([]);
      expect(mine(mismatches, b)).toEqual([]);
    });

    it('thiếu hóa đơn → không báo giả, nhưng có ghi nhận mức info để biết ngày đó chưa đối soát', async () => {
      const provider = newProvider();
      const day = await reconcileDate();
      await seedLedger(provider, day, [5_000_000]); // sổ có tiền, hóa đơn chưa nhập
      const { mismatches, notes } = await reconcile();
      expect(mine(mismatches, provider)).toEqual([]);
      const note = mine(notes, provider);
      expect(note).toHaveLength(1);
      expect(note[0]).toMatchObject({ level: 'info', provider, invoice_date: day });
      // Không có cảnh báo mức warn nào cho nhà cung cấp này.
      expect(log.entries.filter((e) => e.provider === provider && e.level === 'warn')).toEqual([]);
    });

    it('hóa đơn có nhưng sổ không có dòng nào (Σ = 0) → lệch 100%, cảnh báo', async () => {
      const provider = newProvider();
      const day = await reconcileDate();
      await setInvoice(provider, day, 1_000_000);
      const events = mine((await reconcile()).mismatches, provider);
      expect(events).toHaveLength(1);
      expect(events[0]!.deviation_pct as number).toBeCloseTo(100, 1);
    });

    it('hóa đơn 0 và sổ 0 → không lỗi chia cho 0, không cảnh báo', async () => {
      const provider = newProvider();
      const day = await reconcileDate();
      await setInvoice(provider, day, 0);
      expect(mine((await reconcile()).mismatches, provider)).toEqual([]);
    });

    it('chỉ đối soát NGÀY HÔM TRƯỚC và đúng nhà cung cấp: dòng sổ ngày khác, nhà cung cấp khác không lẫn vào', async () => {
      const provider = newProvider();
      const other = newProvider();
      const day = await reconcileDate();
      await seedLedger(provider, day, [1_000_000]); // khớp hóa đơn ngày hôm trước
      await setInvoice(provider, day, 1_000_000);
      await seedLedger(provider, addDays(day, -1), [9_000_000]); // ngày kia: không được cộng vào
      await seedLedger(provider, addDays(day, 1), [9_000_000]); // hôm nay: chưa đối soát
      await seedLedger(other, day, [7_000_000]); // nhà cung cấp khác cùng ngày
      // Hóa đơn lệch của NGÀY KHÁC không được xét ở lần chạy này.
      await setInvoice(provider, addDays(day, -1), 1_000);
      const { mismatches } = await reconcile();
      expect(mine(mismatches, provider)).toEqual([]);
    });

    it('nhiều nhà cung cấp cùng ngày: mỗi nhà cung cấp một kết luận riêng', async () => {
      const bad = newProvider();
      const good = newProvider();
      const day = await reconcileDate();
      await seedLedger(bad, day, [1_100_000]);
      await setInvoice(bad, day, 1_000_000);
      await seedLedger(good, day, [1_000_000]);
      await setInvoice(good, day, 1_000_000);
      const { mismatches } = await reconcile();
      expect(mine(mismatches, bad)).toHaveLength(1);
      expect(mine(mismatches, good)).toEqual([]);
    });

    it('chạy lại hai lần cho cùng kết quả: cùng nhật ký mỗi lần, sổ và hóa đơn không đổi', async () => {
      const provider = newProvider();
      const day = await reconcileDate();
      await seedLedger(provider, day, [1_060_000]);
      await setInvoice(provider, day, 1_000_000);
      const before = await dataFingerprint(provider);
      const first = mine((await reconcile()).mismatches, provider);
      const second = mine((await reconcile()).mismatches, provider);
      expect(first).toHaveLength(1);
      expect(signature(second)).toEqual(signature(first));
      expect(await dataFingerprint(provider)).toEqual(before);
    });

    it('ngày đối soát đúng là "hôm qua" theo giờ Việt Nam (đồng hồ CSDL)', async () => {
      const today = await localToday();
      expect(await reconcileDate()).toBe(addDays(today, -1));
    });
  });
});
