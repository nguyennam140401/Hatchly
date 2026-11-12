import { inject } from 'vitest';
import { runWithJobContext } from '../../../src/core/context/bind-account';
import { tenantTx, currentAccountId } from '../../../src/core/db/transaction';
import { MemoryMailTransport } from '../../../src/core/mail/memory.transport';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { listActiveMembers } from '../../../src/modules/account/internal/members-directory';
import { deliverNotification } from '../../../src/modules/notifications/internal/deliver.handler';
import { QueueEmitter } from '../../../src/modules/notifications/internal/emit';
import { getNotificationStore } from '../../../src/modules/notifications/internal/fake';
import { notifyDeliverJob } from '../../../src/modules/notifications/jobs';
import { registerJobHandler } from '../../../src/modules/queue';
import { createAccount } from '../../db/helpers/db';
import { removeSeededMember, seedMember } from '../../db/helpers/members';
import { jobs, waitFor } from '../../queue/helpers/queue-db';
import { startTestProducer, startTestWorkers, type TestWorkers } from '../../support/queue-test-kit';
import type { NotifyHarness } from './harness';

// Harness `sandbox` (005, R9b): `tx()` = tenantTx thật; `flush()` = runtime Worker THẬT trong tiến trình
// kiểm thử (chỉ hàng chờ `notify`) chạy hết việc – không gọi thẳng bộ xử lý, nên kiểm cả bước Worker dựng
// lại ngữ cảnh tenant từ dữ liệu việc (nguyên tắc I). Thành viên thật trong account.memberships.

let registered = false;

export async function makeSandboxNotifyHarness(): Promise<{
  harness: NotifyHarness;
  close: () => Promise<void>;
}> {
  void inject('dbUrls');
  const store = await getNotificationStore('sandbox');
  const mail = new MemoryMailTransport();
  const deps = { members: { listActiveMembers }, mailer: mail, webBaseUrl: 'http://app.test' };
  if (!registered) {
    registered = true;
    registerJobHandler(notifyDeliverJob, async ({ event }) => {
      await deliverNotification(event, { ...deps, store });
    });
  }
  const stopProducer = await startTestProducer();
  const workers: TestWorkers = await startTestWorkers(1, { queues: ['notify'] });

  const pendingFor = async (accountId: string) =>
    (
      await jobs(
        "data->>'type' = 'notifications.deliver' AND data->>'accountId' = $1 AND state IN ('created', 'retry', 'active')",
        [accountId],
      )
    ).length;

  const harness: NotifyHarness = {
    mode: 'sandbox',
    hasRealTx: true,
    async newAccount() {
      const accountId = await createAccount();
      const o = await seedMember(accountId, { role: 'owner', seat: 0, name: 'Chủ' });
      const c = await seedMember(accountId, { role: 'collaborator', seat: 1, name: 'CTV' });
      return {
        accountId,
        owner: { userId: o.userId, role: 'owner', email: o.email, displayName: 'Chủ' },
        collaborator: { userId: c.userId, role: 'collaborator', email: c.email, displayName: 'CTV' },
      };
    },
    inAccount: (accountId, fn) => runWithJobContext({ traceId: uuidV7(), accountId }, fn),
    tx: (fn) => tenantTx(fn),
    notifications: new QueueEmitter(),
    async flush() {
      const accountId = currentAccountId();
      if (accountId === null) throw new Error('flush cần ngữ cảnh tài khoản');
      await waitFor(async () => (await pendingFor(accountId)) === 0, 30_000, 50, 'hết việc notify');
    },
    removeMember: (userId) => removeSeededMember(userId),
    store,
    deps,
    mail,
    async pendingJobs() {
      const accountId = currentAccountId();
      return accountId === null ? 0 : pendingFor(accountId);
    },
  };
  return {
    harness,
    close: async () => {
      await workers.stop();
      await stopProducer();
    },
  };
}
