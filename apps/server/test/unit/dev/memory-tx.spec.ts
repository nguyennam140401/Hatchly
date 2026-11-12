import { describe, expect, it } from 'vitest';
import { runWithJobContext } from '../../../src/core/context/bind-account';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { isMemoryTx, memoryTx } from '../../../src/dev/memory-tx';
import { MemoryScenarioStore } from '../../../src/dev/scenarios';

// 005 T020 (research R9b): memoryTx là vật thế chỗ đúng kiểu nhưng không chạy được SQL; kho kịch bản bộ nhớ.

describe('memoryTx', () => {
  it('đánh dấu được, mọi lệnh SQL ném lỗi nêu sai chế độ', () => {
    const tx = memoryTx();
    expect(isMemoryTx(tx)).toBe(true);
    expect(isMemoryTx({})).toBe(false);
    expect(isMemoryTx(null)).toBe(false);
    expect(() => tx.select()).toThrow('memoryTx không chạy được SQL – sai chế độ FAKE_STATE_STORE');
    expect(() => Reflect.get(tx, 'execute')).toThrow(/sai chế độ FAKE_STATE_STORE/);
    expect(() => Reflect.get(tx, '$client')).toThrow(/sai chế độ/);
  });

  it('await / in gỡ lỗi không ném', async () => {
    const tx = memoryTx();
    await expect(Promise.resolve(tx)).resolves.toBe(tx);
    expect(JSON.stringify({ tx })).toBe('{"tx":{}}');
  });
});

describe('MemoryScenarioStore', () => {
  const inAccount = <T>(accountId: string, fn: () => Promise<T>) =>
    runWithJobContext({ traceId: uuidV7(), accountId }, fn);

  it('take: khớp chính xác trước rồi *, cũ nhất trước; remainingUses tiêu dần rồi tự xóa', async () => {
    const store = new MemoryScenarioStore();
    const a = uuidV7();
    await inAccount(a, async () => {
      await store.put({ component: 'platform', target: '*', spec: { n: 'any' } });
      await store.put({
        component: 'platform',
        target: 'connection:1',
        spec: { n: 1 },
        remainingUses: 1,
      });
      await store.put({
        component: 'platform',
        target: 'connection:1',
        spec: { n: 2 },
        remainingUses: 2,
      });
      expect((await store.take('platform', 'connection:1'))?.spec).toEqual({ n: 1 });
      expect((await store.take('platform', 'connection:1'))?.spec).toEqual({ n: 2 });
      expect((await store.take('platform', 'connection:1'))?.spec).toEqual({ n: 2 });
      // Hết lượt của đích chính xác → rơi về '*' (không giới hạn, không bị tiêu).
      expect((await store.take('platform', 'connection:1'))?.spec).toEqual({ n: 'any' });
      expect((await store.take('platform', 'connection:1'))?.spec).toEqual({ n: 'any' });
      expect(await store.take('ai', '*')).toBeNull();
      expect(await store.list()).toHaveLength(1);
    });
  });

  it('theo tài khoản: A không thấy kịch bản của B; ngoài ngữ cảnh → TenantContextError', async () => {
    const store = new MemoryScenarioStore();
    const a = uuidV7();
    const b = uuidV7();
    await inAccount(b, () => store.put({ component: 'ai', target: '*', spec: { fail: 'error' } }));
    expect(await inAccount(a, () => store.list())).toEqual([]);
    expect(await inAccount(a, () => store.take('ai', '*'))).toBeNull();
    expect(await inAccount(b, () => store.list())).toHaveLength(1);
    await expect(store.list()).rejects.toMatchObject({ name: 'TenantContextError' });
  });
});
