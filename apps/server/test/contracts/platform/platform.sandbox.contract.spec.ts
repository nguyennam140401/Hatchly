import { afterAll, beforeAll } from 'vitest';
import { listRegisteredAdapters } from '../../../src/modules/platform_gateway/internal/adapters/registry';
import { createAccount, describeDb, makeDatabase, type TestDatabase } from '../../db/helpers/db';
import { describePlatformAdapterContract } from './adapter.contract';
import { describePlatformGatewayContract } from './gateway.contract';
import { makePlatformHarness, type PlatformHarness } from './harness';

// 005 T024: bản giả lập Cổng nền tảng, kho `sandbox` (bảng sandbox.pg_fake_*, RLS) – pnpm test:db.

let harness: PlatformHarness;
let database: TestDatabase;

describeDb('Cổng nền tảng – bản giả lập (sandbox)', () => {
  beforeAll(async () => {
    database = makeDatabase({ unit: 'api' });
    harness = await makePlatformHarness('sandbox', {
      a: await createAccount(),
      b: await createAccount(),
    });
  });
  afterAll(async () => {
    await database.close();
  });

  for (const type of ['facebook_page', 'instagram', 'zalo_oa', 'test_channel'] as const) {
    describePlatformAdapterContract(
      () => {
        const adapter = listRegisteredAdapters().find((a) => a.channelType === type);
        if (adapter === undefined) throw new Error(`Chưa đăng ký bộ chuyển đổi ${type}`);
        return adapter;
      },
      () => harness,
    );
  }
  describePlatformGatewayContract(() => harness);
});
