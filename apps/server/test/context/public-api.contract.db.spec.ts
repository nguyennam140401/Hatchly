// Nhóm (e) – hợp đồng giao diện công khai `ContextPublicApi` (006 contracts/context-public-api.md mục 1,
// FR-013, FR-014, FR-015, SC-005). Chép mẫu này khi: module xuất hàm cho module khác – kiểm theo bảng
// hợp đồng: có dữ liệu / chưa có / không ngữ cảnh / ngay sau ghi / trong việc nền / không rò trường
// nội bộ (accountId, người lưu, thông tin liên hệ).
import { afterAll, beforeAll, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { describeMembers } from '../../src/modules/account/internal/members/describe-members';
import { contextPublicApi } from '../../src/modules/context/internal/public-api.impl';
import { ProfileService } from '../../src/modules/context/internal/profile.service';
import { defineJobType, registerJobHandler } from '../../src/modules/queue';
import { z } from 'zod';
import { runJobInline, startTestProducer } from '../support/queue-test-kit';
import {
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from '../db/helpers/db';

const fields = (tone: string) => ({
  industryCode: 'food_beverage' as const,
  industryOther: null,
  introduction: 'Quán phở gia truyền.',
  products: 'Phở bò, phở gà',
  policies: null,
  tone,
  keywords: ['phở'],
});

// Việc thử chỉ để chạy getCurrentProfile trong ngữ cảnh việc nền (như module khác ở Worker).
const probeJob = defineJobType({
  name: 'sandbox.context_probe',
  queue: 'ai_batch',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({}),
});
let probed: unknown;
registerJobHandler(probeJob, async () => {
  probed = await contextPublicApi.getCurrentProfile();
});

describeDb('ContextPublicApi.getCurrentProfile – hợp đồng', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  const service = new ProfileService({ describeMembers });
  let a: string;
  let b: string;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 3 });
    stopProducer = await startTestProducer();
    a = await createAccount();
    b = await createAccount();
    await withAccount(a, async () => {
      await service.saveProfile(0, fields('v1'), uuidV7());
      await service.saveProfile(1, fields('v2'), uuidV7());
      await service.saveProfile(2, fields('v3'), uuidV7());
    });
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  it('A có v3 → đúng nội dung v3, version 3', async () => {
    const p = await withAccount(a, () => contextPublicApi.getCurrentProfile());
    expect(p).toMatchObject({
      version: 3,
      tone: 'v3',
      keywords: ['phở'],
      industryCode: 'food_beverage',
    });
  });

  it('B chưa có hồ sơ → null (không phải lỗi)', async () => {
    expect(await withAccount(b, () => contextPublicApi.getCurrentProfile())).toBeNull();
  });

  it('không ngữ cảnh tenant → TENANT_CONTEXT_MISSING', async () => {
    await expect(contextPublicApi.getCurrentProfile()).rejects.toMatchObject({
      code: 'TENANT_CONTEXT_MISSING',
    });
  });

  it('ngay sau khi lưu v4 → lần gọi kế tiếp trả v4 (không cache – SC-005)', async () => {
    await withAccount(a, () => service.saveProfile(3, fields('v4'), uuidV7()));
    expect(await withAccount(a, () => contextPublicApi.getCurrentProfile())).toMatchObject({
      version: 4,
      tone: 'v4',
    });
  });

  it('trong việc nền của A (runJobInline) → hồ sơ A', async () => {
    probed = undefined;
    await runJobInline(probeJob, {}, { accountId: a });
    expect(probed).toMatchObject({ version: 4 });
  });

  it('kết quả chỉ có trường nghiệp vụ – không accountId, người lưu, email, số điện thoại', async () => {
    const p = await withAccount(a, () => contextPublicApi.getCurrentProfile());
    expect(Object.keys(p!).sort()).toEqual(
      [
        'profileId',
        'version',
        'savedAt',
        'industryCode',
        'industryOther',
        'introduction',
        'products',
        'policies',
        'tone',
        'keywords',
      ].sort(),
    );
    const json = JSON.stringify(p);
    for (const forbidden of [
      'accountId',
      'account_id',
      'savedByUserId',
      'saved_by',
      'email',
      'phone',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });
});
