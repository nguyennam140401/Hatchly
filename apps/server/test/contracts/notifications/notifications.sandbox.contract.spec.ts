import { NOTIFY_DELIVER_JOB, NotificationEventSchema } from '@app/shared/notifications';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { tenantTx } from '../../../src/core/db/transaction';
import { enqueueRegistered } from '../../../src/modules/queue/enqueue-registered';
import { describeDb, makeDatabase, type TestDatabase } from '../../db/helpers/db';
import { setQueueSettings, resetQueueSettings } from '../../queue/helpers/queue-db';
import { makeSandboxNotifyHarness } from './harness.sandbox';
import { describeNotificationsContract } from './notifications.contract';
import type { NotifyHarness } from './harness';

// 005 T067: Thông báo – bản giả lập, chế độ `sandbox` (pnpm test:db): giao dịch thật, Worker thật.

let harness: NotifyHarness;
let close: () => Promise<void>;
let database: TestDatabase;

describeDb('Thông báo – bản giả lập (sandbox)', () => {
  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    await setQueueSettings('notify', { poll_interval_ms: 200 });
    ({ harness, close } = await makeSandboxNotifyHarness());
  });
  afterAll(async () => {
    await close();
    await resetQueueSettings();
    await database.close();
  });

  describeNotificationsContract(() => harness);

  it('lối phát của account (enqueueRegistered) được xử lý như emit', async () => {
    const acc = await harness.newAccount();
    await harness.inAccount(acc.accountId, async () => {
      await tenantTx((tx) =>
        enqueueRegistered(tx, NOTIFY_DELIVER_JOB, {
          event: NotificationEventSchema.parse({ type: 'plan_expiring', refs: { subscriptionId: acc.owner.userId, expiresOn: '2026-12-31' } }),
        }),
      );
      await harness.flush();
      const got = await harness.store.delivered({ type: 'plan_expiring' });
      expect(got.map((n) => n.channel).sort()).toEqual(['email', 'in_app']);
    });
  });
});
