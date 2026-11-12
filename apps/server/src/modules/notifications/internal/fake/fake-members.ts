import type { ActiveMember } from '../../../account';
import { requireFakeAccount } from '../../../../dev/fake-components';
import { syncPromise } from '../../../../dev/scenarios';
import type { MembersDirectory } from '../recipients';

// Danh bạ thành viên GIẢ cho chế độ `memory` (005, R9b) – cài `AccountPublicApi.listActiveMembers` theo
// tài khoản của ngữ cảnh; harness đặt/gỡ thành viên.

export class FakeAccountMembers implements MembersDirectory {
  private readonly byAccount = new Map<string, ActiveMember[]>();

  set(members: ActiveMember[]): void {
    this.byAccount.set(requireFakeAccount(), members.map((m) => ({ ...m })));
  }

  remove(userId: string): void {
    const accountId = requireFakeAccount();
    this.byAccount.set(accountId, (this.byAccount.get(accountId) ?? []).filter((m) => m.userId !== userId));
  }

  listActiveMembers(): Promise<ActiveMember[]> {
    return syncPromise(() => (this.byAccount.get(requireFakeAccount()) ?? []).map((m) => ({ ...m })));
  }
}
