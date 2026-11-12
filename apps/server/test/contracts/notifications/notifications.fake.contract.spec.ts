import { beforeAll, describe } from 'vitest';
import { runWithJobContext } from '../../../src/core/context/bind-account';
import { MemoryMailTransport } from '../../../src/core/mail/memory.transport';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { memoryTx } from '../../../src/dev/memory-tx';
import { fakeNotify } from '../../../src/modules/notifications';
import {
  FakeAccountMembers,
  getMemoryEmitter,
  getNotificationStore,
} from '../../../src/modules/notifications/internal/fake';
import { describeNotificationsContract } from './notifications.contract';
import type { NotifyHarness } from './harness';

// 005 T067: Thông báo – bản giả lập, chế độ `memory` (pnpm test). Mục 4 "giao dịch hủy" chỉ ở sandbox
// (memoryTx không có giao dịch thật – research R9b).

let harness: NotifyHarness;

beforeAll(async () => {
  const store = await getNotificationStore('memory');
  const members = new FakeAccountMembers();
  const mail = new MemoryMailTransport();
  const deps = { members, mailer: mail, webBaseUrl: 'http://app.test' };
  const control = fakeNotify(store, deps);
  harness = {
    mode: 'memory',
    hasRealTx: false,
    async newAccount() {
      const accountId = uuidV7();
      const owner = { userId: uuidV7(), role: 'owner' as const, email: `chu-${accountId.slice(-6)}@example.test`, displayName: 'Chủ' };
      const collaborator = { userId: uuidV7(), role: 'collaborator' as const, email: `ctv-${accountId.slice(-6)}@example.test`, displayName: 'CTV' };
      await runWithJobContext({ traceId: uuidV7(), accountId }, async () => {
        members.set([owner, collaborator]);
      });
      return { accountId, owner, collaborator };
    },
    inAccount: (accountId, fn) => runWithJobContext({ traceId: uuidV7(), accountId }, fn),
    tx: (fn) => fn(memoryTx()),
    notifications: getMemoryEmitter(),
    flush: () => control.flush(),
    removeMember: (userId) => {
      members.remove(userId);
      return Promise.resolve();
    },
    store,
    deps,
    mail,
    pendingJobs: () => Promise.resolve(getMemoryEmitter().pendingCount()),
  };
});

describe('Thông báo – bản giả lập (memory)', () => {
  describeNotificationsContract(() => harness);
});
