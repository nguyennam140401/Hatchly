import type { FakeStateStore } from '../../../../dev/fake-components';
import { getScenarioStore } from '../../../../dev/scenarios';
import type { ChannelType } from '../../public-api';
import { FakePlatformAdapter } from './fake-adapter';
import type { FakePlatformStore, FakePost } from './post-store';
import { FakeStep } from './scenarios';
import { MemoryFakePlatformStore } from './store.memory';

// Lối vào bản giả lập Cổng nền tảng (005) – kho trạng thái theo chế độ (một thể hiện mỗi chế độ trong
// tiến trình) + API lập trình cho kiểm thử / route quản trị `/dev/fakes`. CHỈ development/test.

let memoryStore: MemoryFakePlatformStore | undefined;
let sandboxStore: Promise<FakePlatformStore> | undefined;

export function getFakePlatformStore(mode: FakeStateStore): Promise<FakePlatformStore> {
  if (mode === 'memory') return Promise.resolve((memoryStore ??= new MemoryFakePlatformStore()));
  // Nạp động: schema sandbox chỉ hợp lệ ở development/test.
  sandboxStore ??= import('./store.sandbox.js').then((m) => new m.SandboxFakePlatformStore());
  return sandboxStore;
}

export function makeFakeAdapterFactory(
  mode: FakeStateStore,
  store: FakePlatformStore,
): (type: ChannelType) => FakePlatformAdapter {
  return (type) => new FakePlatformAdapter(type, store, () => getScenarioStore(mode));
}

export interface FakePlatformControl {
  /** Dàn các bước cho `target` (`connection:{id}` | `*`), mỗi bước dùng một lần theo thứ tự. */
  script(target: string, steps: FakeStep[]): Promise<void>;
  publishedCount(contentHash: string): Promise<number>;
  posts(connectionId?: string): Promise<FakePost[]>;
  /** Xóa kịch bản + trạng thái giả của tài khoản trong ngữ cảnh. */
  reset(): Promise<void>;
}

export function fakePlatform(mode: FakeStateStore): FakePlatformControl {
  return {
    async script(target, steps) {
      const scenarios = await getScenarioStore(mode);
      for (const step of steps) {
        await scenarios.put({
          component: 'platform',
          target,
          spec: FakeStep.parse(step),
          remainingUses: 1,
        });
      }
    },
    async publishedCount(contentHash) {
      return (await getFakePlatformStore(mode)).publishedCount(contentHash);
    },
    async posts(connectionId) {
      return (await getFakePlatformStore(mode)).listPosts(connectionId);
    },
    async reset() {
      const scenarios = await getScenarioStore(mode);
      for (const s of await scenarios.list()) {
        if (s.component === 'platform') await scenarios.delete(s.id);
      }
      await (await getFakePlatformStore(mode)).reset();
    },
  };
}

export { FakeOauthController } from './fake-oauth.controller';
export { FakeOauthPages, FakeStep, PlatformScenarioSpec } from './scenarios';
export type { FakePlatformStore, FakePost } from './post-store';
