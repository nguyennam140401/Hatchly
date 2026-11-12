// Nhóm (c) – cô lập hồ sơ kinh doanh (006 US3, FR-009, FR-010, FR-011, SC-002).
// Chép mẫu này khi: bảng mới có thao tác đọc theo mã (`…/:id`) hoặc lịch sử bất biến – kiểm (1) không
// ngữ cảnh tenant → 0 dòng, (2) mã của tài khoản khác ≡ mã ngẫu nhiên (cùng một lỗi 404), (3) REVOKE
// chặn sửa/xóa lịch sử, (4) xóa tài khoản → CASCADE dọn sạch.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors/app-error';
import { tenantTx } from '../../src/core/db/transaction';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { describeMembers } from '../../src/modules/account/internal/members/describe-members';
import { profileVersions } from '../../src/modules/context/internal/db/schema';
import { ProfileService } from '../../src/modules/context/internal/profile.service';
import { startTestProducer } from '../support/queue-test-kit';
import {
  asOwner,
  countByAccount,
  createAccount,
  describeDb,
  makeDatabase,
  rawAppPool,
  withAccount,
  type TestDatabase,
} from './helpers/db';

const fields = {
  industryCode: 'education' as const,
  industryOther: null,
  introduction: 'Lớp tiếng Anh cho trẻ em.',
  products: null,
  policies: null,
  tone: null,
  keywords: [],
};

describeDb('Cô lập hồ sơ kinh doanh', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  const service = new ProfileService({ describeMembers });
  let a: string;
  let b: string;
  let versionOfA: string;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 4 });
    stopProducer = await startTestProducer();
    a = await createAccount();
    b = await createAccount();
    await withAccount(a, () => service.saveProfile(0, fields, uuidV7()));
    const list = await withAccount(a, () => service.listVersions(1));
    versionOfA = list.items[0]!.versionId;
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  it('vai trò app không đặt ngữ cảnh tenant → 0 dòng ở cả hai bảng', async () => {
    const pool = rawAppPool();
    try {
      for (const table of ['context.business_profiles', 'context.profile_versions']) {
        const r = await pool.query(`SELECT * FROM ${table}`);
        expect(r.rowCount, table).toBe(0);
      }
    } finally {
      await pool.end();
    }
  });

  it('B đọc phiên bản của A theo mã ≡ mã ngẫu nhiên: cùng NOT_FOUND, cùng thông điệp', async () => {
    const errOther = await withAccount(b, () => service.getVersion(versionOfA)).catch(
      (e: unknown) => e,
    );
    const errRandom = await withAccount(b, () => service.getVersion(uuidV7())).catch(
      (e: unknown) => e,
    );
    for (const err of [errOther, errRandom]) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('NOT_FOUND');
      expect((err as AppError).httpStatus).toBe(404);
    }
    expect((errOther as AppError).message).toBe((errRandom as AppError).message);
    // A vẫn đọc được của mình.
    const own = await withAccount(a, () => service.getVersion(versionOfA));
    expect(own.isCurrent).toBe(true);
  });

  it('B không thấy hồ sơ/lịch sử của A', async () => {
    expect(await withAccount(b, () => service.getProfile())).toMatchObject({ profile: null });
    expect((await withAccount(b, () => service.listVersions(1))).total).toBe(0);
  });

  it('lịch sử bất biến: app UPDATE/DELETE profile_versions → bị từ chối (REVOKE 0013)', async () => {
    await expect(
      withAccount(a, () => tenantTx((db) => db.update(profileVersions).set({ tone: 'sửa lén' }))),
    ).rejects.toThrow();
    await expect(
      withAccount(a, () => tenantTx((db) => db.delete(profileVersions))),
    ).rejects.toThrow();
    expect((await countByAccount('context.profile_versions'))[a]).toBe(1);
  });

  it('xóa tài khoản → CASCADE xóa hồ sơ và mọi phiên bản', async () => {
    const c = await createAccount();
    await withAccount(c, () => service.saveProfile(0, fields, uuidV7()));
    await withAccount(c, () => service.saveProfile(1, { ...fields, tone: 'Nhẹ nhàng' }, uuidV7()));
    expect((await countByAccount('context.profile_versions'))[c]).toBe(2);
    await asOwner((client) => client.query('DELETE FROM account.accounts WHERE id = $1', [c]));
    expect((await countByAccount('context.profile_versions'))[c]).toBeUndefined();
    expect((await countByAccount('context.business_profiles'))[c]).toBeUndefined();
  });
});
