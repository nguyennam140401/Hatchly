// 010 T017 (R7): cổng ngược – `publishing.countScheduledByConnections` đếm đúng lượt CHƯA gửi theo từng kênh, chỉ trong
// tài khoản của ngữ cảnh; bộ đăng ký trả bản rỗng khi chưa đăng ký.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import {
  connectionConsumers,
  registerConnectionConsumers,
  resetConnectionConsumers,
} from '../../../src/modules/platform_gateway/internal/connections/consumers';
import type { PlatformGatewayPublicApi } from '../../../src/modules/platform_gateway';
import { PublishingService } from '../../../src/modules/publishing/internal/publishing.service';
import type { ContentService } from '../../../src/modules/content/internal/content.service';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from '../helpers/db';

describeDb('Cổng ngược kênh ↔ đăng bài', () => {
  let database: TestDatabase;
  let a: string;
  let b: string;
  const publishing = new PublishingService(
    {} as unknown as ContentService,
    {} as unknown as PlatformGatewayPublicApi,
  );

  async function attempt(
    accountId: string,
    connectionId: string,
    status: string,
    at: Date,
  ): Promise<void> {
    const needs = status === 'needs_user' || status === 'needs_check';
    await asOwner((c) =>
      c.query(
        `INSERT INTO publishing.publish_attempts
           (id, account_id, post_id, channel_connection_id, channel_type, status, scheduled_at, content_version, needs_reason, phase)
         VALUES ($1, $2, $3, $4, 'test_channel', $5, $6, 1, $7, $8)`,
        [
          uuidV7(),
          accountId,
          uuidV7(),
          connectionId,
          status,
          at,
          needs ? 'other' : null,
          status === 'succeeded' ? 'finished' : 'none',
        ],
      ),
    );
  }

  beforeAll(async () => {
    database = makeDatabase();
    a = await createAccount();
    b = await createAccount();
  });
  afterAll(async () => {
    await database.close();
  });
  beforeEach(() => {
    resetConnectionConsumers();
  });

  it('đếm lượt scheduled/retry_wait + giờ gần nhất theo kênh; bỏ qua succeeded; kênh trống = 0', async () => {
    const c1 = uuidV7();
    const c2 = uuidV7();
    const empty = uuidV7();
    const soon = new Date(Date.now() + 3_600_000);
    const later = new Date(Date.now() + 7_200_000);
    await attempt(a, c1, 'scheduled', later);
    await attempt(a, c1, 'retry_wait', soon);
    await attempt(a, c1, 'succeeded', new Date(Date.now() - 3_600_000));
    await attempt(a, c2, 'scheduled', later);

    const map = await withAccount(a, () => publishing.countScheduledByConnections([c1, c2, empty]));
    expect(map.get(c1)).toEqual({ count: 2, nextAt: soon });
    expect(map.get(c2)).toEqual({ count: 1, nextAt: later });
    expect(map.get(empty)).toEqual({ count: 0, nextAt: null });
  });

  it('tài khoản khác không thấy lượt của tài khoản này (RLS) – cùng mã kênh vẫn 0', async () => {
    const c = uuidV7();
    await attempt(a, c, 'scheduled', new Date(Date.now() + 3_600_000));
    const asB = await withAccount(b, () => publishing.countScheduledByConnections([c]));
    expect(asB.get(c)).toEqual({ count: 0, nextAt: null });
    expect(
      (await withAccount(a, () => publishing.countScheduledByConnections([c]))).get(c)?.count,
    ).toBe(1);
  });

  it('danh sách rỗng ⇒ bản đồ rỗng, không truy vấn', async () => {
    expect((await withAccount(a, () => publishing.countScheduledByConnections([]))).size).toBe(0);
  });

  it('chưa đăng ký ⇒ bản rỗng; đăng ký rồi ⇒ dùng bản của publishing', async () => {
    const id = uuidV7();
    expect((await connectionConsumers().scheduledImpact([id])).get(id)).toEqual({
      count: 0,
      nextAt: null,
    });
    expect(await connectionConsumers().errorMappings()).toEqual([]);
    expect(await connectionConsumers().onDisconnect({} as never, id)).toEqual({ cancelled: 0 });

    registerConnectionConsumers({
      scheduledImpact: () => Promise.resolve(new Map([[id, { count: 7, nextAt: null }]])),
      onDisconnect: () => Promise.resolve({ cancelled: 3 }),
      errorMappings: () => Promise.resolve([]),
    });
    expect((await connectionConsumers().scheduledImpact([id])).get(id)?.count).toBe(7);
    expect(await connectionConsumers().onDisconnect({} as never, id)).toEqual({ cancelled: 3 });
  });
});
