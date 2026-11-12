import type { Db } from '../../../../core';
import type { FakeStateStore } from '../../../../dev/fake-components';
import { getScenarioStore } from '../../../../dev/scenarios';
import { JsonPriceSource, PriceBook } from '../prices/price-book';
import type { FakeBudgetStore } from './fake-budget';
import { FakeAiProvider, FakeAiStep } from './fake-provider';
import prices from './prices.fake.json';
import { MemoryBudgetStore } from './store.memory';

// Lối vào bản giả lập Cổng AI (005) – kho ngân sách theo chế độ, nhà cung cấp giả ×2, bảng giá giả, API
// lập trình `fakeAi` cho kiểm thử / route quản trị. CHỈ development/test.

export interface FakeAiBundle {
  store: FakeBudgetStore;
  primary: FakeAiProvider;
  fallback: FakeAiProvider;
  prices: PriceBook;
}

let memoryStore: MemoryBudgetStore | undefined;
let sandboxStore: Promise<FakeBudgetStore> | undefined;

export function getFakeBudgetStore(
  mode: FakeStateStore,
  opts: {
    systemWeeklyCap: number;
    onReserved?: (tx: Db, r: { id: string; reservedAt: Date }) => Promise<void>;
  },
): Promise<FakeBudgetStore> {
  if (mode === 'memory') {
    return Promise.resolve((memoryStore ??= new MemoryBudgetStore(opts.systemWeeklyCap)));
  }
  sandboxStore ??= import('./store.sandbox.js').then((m) => new m.SandboxBudgetStore(opts));
  return sandboxStore;
}

export async function makeFakePriceBook(): Promise<PriceBook> {
  const book = new PriceBook(new JsonPriceSource(prices as never));
  await book.refresh();
  return book;
}

export async function makeFakeAiBundle(
  mode: FakeStateStore,
  opts: Parameters<typeof getFakeBudgetStore>[1],
): Promise<FakeAiBundle> {
  const scenarios = () => getScenarioStore(mode);
  return {
    store: await getFakeBudgetStore(mode, opts),
    primary: new FakeAiProvider('primary', scenarios),
    fallback: new FakeAiProvider('fallback', scenarios),
    prices: await makeFakePriceBook(),
  };
}

/** API lập trình: dàn bước cho nhà cung cấp (`primary`/`fallback`, mặc định cả hai qua `*`). */
export function fakeAi(mode: FakeStateStore, store: FakeBudgetStore) {
  return {
    setBudget: store.setBudget.bind(store),
    getBudget: store.getBudget.bind(store),
    ledger: store.ledger.bind(store),
    reservations: store.reservations.bind(store),
    ageReservations: store.ageReservations.bind(store),
    async script(steps: FakeAiStep[], provider: 'primary' | 'fallback' | '*' = '*') {
      const scenarios = await getScenarioStore(mode);
      for (const step of steps) {
        await scenarios.put({
          component: 'ai',
          target: provider === '*' ? '*' : `provider:${provider}`,
          spec: FakeAiStep.parse(step),
          remainingUses: 1,
        });
      }
    },
    async reset() {
      const scenarios = await getScenarioStore(mode);
      for (const s of await scenarios.list())
        if (s.component === 'ai') await scenarios.delete(s.id);
      await store.reset();
    },
  };
}

export { FakeAiStep } from './fake-provider';
export type { FakeBudgetStore, FakeBudgetView } from './fake-budget';
