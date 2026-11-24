// T059 (015 US7, R-11, contracts/ai-gateway-delta.md mục 5): chưa có hiện thực `IndustryAccountsSource` → việc phân bổ bị
// BỎ QUA kèm cảnh báo `ai.industry_source_missing` (không ném lỗi để không đốt hàng chờ, không ghi dòng nào).
// Tệp riêng vì bộ xử lý chỉ đăng ký được một lần cho mỗi tiến trình kiểm thử (ở đây: không có nguồn).
import { afterAll, beforeAll, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { describeDb, makeDatabase, type TestDatabase } from '../db/helpers/db';
import { runJobInline } from '../support/queue-test-kit';
import {
  allocationJob,
  allocationRows,
  cleanupAllocations,
  logOccurrences,
  registerAllocationHandler,
  seedSystemLedger,
} from './helpers/allocation-kit';

const WEEK = '2035-03-05';
const industryId = uuidV7();

describeDb('Phân bổ chi phí xu hướng – thiếu nguồn tài khoản theo ngành (015 US7)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 4 });
    await registerAllocationHandler(undefined);
  });
  afterAll(async () => {
    await cleanupAllocations([industryId]);
    await database.close();
  });

  it('không có nguồn → việc xong không lỗi, không ghi dòng phân bổ, phát ai.industry_source_missing mỗi lần chạy', async () => {
    await seedSystemLedger({ weekStart: WEEK, industryId, cost: 9_000 });
    const before = logOccurrences('ai.industry_source_missing');
    await expect(
      runJobInline(allocationJob(), { weekStart: WEEK, industryId }),
    ).resolves.not.toThrow();
    expect(await allocationRows(WEEK, industryId)).toEqual([]);
    expect(logOccurrences('ai.industry_source_missing')).toBe(before + 1);
    // Chạy lại hai lần như một: vẫn không ghi gì.
    await runJobInline(allocationJob(), { weekStart: WEEK, industryId });
    expect(await allocationRows(WEEK, industryId)).toEqual([]);
  });
});
