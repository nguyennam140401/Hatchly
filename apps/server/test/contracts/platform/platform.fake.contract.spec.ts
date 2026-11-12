import { beforeAll, describe } from 'vitest';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { listRegisteredAdapters } from '../../../src/modules/platform_gateway/internal/adapters/registry';
import { describePlatformAdapterContract } from './adapter.contract';
import { describePlatformGatewayContract } from './gateway.contract';
import { makePlatformHarness, type PlatformHarness } from './harness';

// 005 T024: bản giả lập Cổng nền tảng, kho `memory` (pnpm test).

let harness: PlatformHarness;

beforeAll(async () => {
  harness = await makePlatformHarness('memory', { a: uuidV7(), b: uuidV7() });
});

// Danh sách kênh lấy từ registry lúc chạy – kênh mới đăng ký tự được kiểm (SC-002).
describe('Cổng nền tảng – bản giả lập (memory)', () => {
  describe.each(['facebook_page', 'instagram', 'zalo_oa', 'test_channel'] as const)('%s', (type) => {
    describePlatformAdapterContract(() => {
      const adapter = listRegisteredAdapters().find((a) => a.channelType === type);
      if (adapter === undefined) throw new Error(`Chưa đăng ký bộ chuyển đổi ${type}`);
      return adapter;
    }, () => harness);
  });
  describePlatformGatewayContract(() => harness);
});
