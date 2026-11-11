import { uuidV7 } from '../core/ids/uuid-v7';
import {
  requireFakeAccount,
  type FakeComponent,
  type FakeScenario,
  type FakeStateStore,
  type PutScenario,
  type ScenarioStore,
} from './fake-components';

// Kho kịch bản của bản giả lập (005, contracts/runtime-config.md mục 3) – hai chế độ cùng giao diện:
// `memory` (Map trong tiến trình, theo tài khoản – tệp này) và `sandbox` (bảng `sandbox.fake_scenarios`,
// RLS – `sandbox/scenario-store.ts`, nạp động để không chạm schema sandbox khi không dùng). Luôn trong ngữ
// cảnh tenant: kịch bản gắn tài khoản của phiên/việc, không bao giờ nhận mã tài khoản.

export type { FakeComponent, FakeScenario, PutScenario, ScenarioStore } from './fake-components';

/** Chạy đồng bộ (nguyên tử trong một lượt vòng lặp sự kiện); lỗi → Promise bị từ chối như bản CSDL. */
export function syncPromise<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

export class MemoryScenarioStore implements ScenarioStore {
  private readonly byAccount = new Map<string, FakeScenario[]>();

  private rows(): FakeScenario[] {
    const accountId = requireFakeAccount();
    let rows = this.byAccount.get(accountId);
    if (rows === undefined) {
      rows = [];
      this.byAccount.set(accountId, rows);
    }
    return rows;
  }

  put(input: PutScenario): Promise<FakeScenario> {
    return syncPromise(() => {
      const row: FakeScenario = {
        id: uuidV7(),
        component: input.component,
        target: input.target,
        spec: structuredClone(input.spec),
        remainingUses: input.remainingUses ?? null,
        createdAt: new Date(),
      };
      this.rows().push(row);
      return structuredClone(row);
    });
  }

  list(): Promise<FakeScenario[]> {
    return syncPromise(() => this.rows().map((r) => structuredClone(r)));
  }

  delete(id: string): Promise<void> {
    return syncPromise(() => {
      const rows = this.rows();
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    });
  }

  clear(): Promise<void> {
    return syncPromise(() => {
      this.rows().length = 0;
    });
  }

  take(component: FakeComponent, target: string): Promise<FakeScenario | null> {
    // Đồng bộ trong một lượt vòng lặp sự kiện → nguyên tử trong tiến trình.
    return syncPromise(() => {
      const rows = this.rows();
      const pick =
        rows.find((r) => r.component === component && r.target === target) ??
        rows.find((r) => r.component === component && r.target === '*');
      if (pick === undefined) return null;
      const taken = structuredClone(pick);
      if (pick.remainingUses !== null) {
        pick.remainingUses -= 1;
        if (pick.remainingUses <= 0) rows.splice(rows.indexOf(pick), 1);
      }
      return taken;
    });
  }
}

// Một kho mỗi chế độ trong tiến trình: bản giả lập của các module và /dev/fakes dùng chung.
let memoryStore: MemoryScenarioStore | undefined;
let sandboxStore: Promise<ScenarioStore> | undefined;

export function getScenarioStore(mode: FakeStateStore): Promise<ScenarioStore> {
  if (mode === 'memory') return Promise.resolve((memoryStore ??= new MemoryScenarioStore()));
  sandboxStore ??= import('./sandbox/scenario-store.js').then((m) => new m.SandboxScenarioStore());
  return sandboxStore;
}
