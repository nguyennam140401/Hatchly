// Nhóm (d) – cạnh tranh ghi (006 US4, FR-005, SC-004): 10 lần lưu đồng thời từ CÙNG một phiên bản → đúng
// 1 thắng, 9 VERSION_CONFLICT, số phiên bản liên tục không lỗ/trùng. Lặp CONCURRENCY_LOOPS lần (CI: 10;
// trước khi merge chạy tay 100 và dán kết quả vào PR).
// Chép mẫu này khi: thao tác ghi dùng khóa lạc quan hoặc chỉ mục duy nhất để chặn ghi đè – bắn N yêu cầu
// thật song song (mỗi yêu cầu một giao dịch/kết nối riêng), đếm thắng/thua và kiểm bất biến dữ liệu.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors/app-error';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { describeMembers } from '../../src/modules/account/internal/members/describe-members';
import { ProfileService } from '../../src/modules/context/internal/profile.service';
import { startTestProducer } from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from './helpers/db';

const LOOPS = Number(process.env.CONCURRENCY_LOOPS ?? '10');
const PARALLEL = 10;

const fields = (n: number) => ({
  industryCode: 'cosmetics' as const,
  industryOther: null,
  introduction: `Mỹ phẩm thiên nhiên – bản ${n}`,
  products: null,
  policies: null,
  tone: null,
  keywords: [],
});

async function versionNumbers(accountId: string): Promise<number[]> {
  return asOwner(async (c) => {
    const r = await c.query<{ v: number }>(
      'SELECT version_number AS v FROM context.profile_versions WHERE account_id = $1 ORDER BY 1',
      [accountId],
    );
    return r.rows.map((row) => row.v);
  });
}

async function race(
  service: ProfileService,
  accountId: string,
  expectedVersion: number,
): Promise<{ ok: number; conflicts: number; other: unknown[] }> {
  const results = await Promise.allSettled(
    Array.from({ length: PARALLEL }, (_, i) =>
      withAccount(accountId, () =>
        service.saveProfile(expectedVersion, fields(expectedVersion * 100 + i), uuidV7()),
      ),
    ),
  );
  const other: unknown[] = [];
  let ok = 0;
  let conflicts = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') ok++;
    else if (r.reason instanceof AppError && r.reason.code === 'VERSION_CONFLICT') conflicts++;
    else other.push(r.reason);
  }
  return { ok, conflicts, other };
}

describeDb(`Cạnh tranh lưu hồ sơ – ${LOOPS} vòng × ${PARALLEL} yêu cầu`, () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  const service = new ProfileService({ describeMembers });

  beforeAll(async () => {
    database = makeDatabase({ poolMax: PARALLEL + 2 });
    stopProducer = await startTestProducer();
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  it('tạo lần đầu (expectedVersion 0) và sửa (N) – đúng 1 thắng mỗi vòng, số phiên bản liên tục', async () => {
    const totals = { ok: 0, conflicts: 0 };
    for (let loop = 0; loop < LOOPS; loop++) {
      const accountId = await createAccount();
      // Vòng tạo lần đầu: chỉ mục duy nhất (account_id) chặn hồ sơ thứ hai.
      const create = await race(service, accountId, 0);
      // Hai vòng sửa từ phiên bản hiện hành.
      const edit1 = await race(service, accountId, 1);
      const edit2 = await race(service, accountId, 2);
      for (const r of [create, edit1, edit2]) {
        expect(r.other).toEqual([]);
        expect(r.ok).toBe(1);
        expect(r.conflicts).toBe(PARALLEL - 1);
        totals.ok += r.ok;
        totals.conflicts += r.conflicts;
      }
      expect(await versionNumbers(accountId)).toEqual([1, 2, 3]);
    }
    // Bằng chứng SC-004 (dán vào mô tả PR khi chạy CONCURRENCY_LOOPS=100).
    console.info(
      `SC-004: ${LOOPS} vòng × 3 đợt × ${PARALLEL} yêu cầu → thắng ${totals.ok}, xung đột ${totals.conflicts}, lỗ/trùng số 0`,
    );
  });
});
