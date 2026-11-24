import { beforeEach, describe, expect, it, vi } from 'vitest';

// 015 US7 (Hiến pháp I, V): `runForAccount` chỉ chạy trong ngữ cảnh việc nền (source 'job').
// Giả lập `currentTx` để kiểm ca "đang trong giao dịch" mà không cần CSDL.
const txState = vi.hoisted(() => ({
  tx: undefined as { role: string; accountId: string | null } | undefined,
}));
vi.mock('../../../src/core/db/transaction', () => ({ currentTx: () => txState.tx }));

import { executionStorage } from '../../../src/core/context/execution-storage';
import { runWithJobContext } from '../../../src/core/context/bind-account';
import { TenantContextError } from '../../../src/core/db/errors';
import { runForAccount } from '../../../src/modules/queue/run-for-account';

const ACC_A = '018f0000-0000-7000-8000-00000000000a';
const ACC_B = '018f0000-0000-7000-8000-00000000000b';

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(TenantContextError);
    return (e as TenantContextError).code;
  }
  throw new Error('mong đợi bị từ chối nhưng đã chạy');
}

describe('runForAccount (015 US7)', () => {
  beforeEach(() => {
    txState.tx = undefined;
  });

  it('không có ngữ cảnh -> TENANT_CONTEXT_FORBIDDEN, không chạy fn', async () => {
    const fn = vi.fn(async () => 1);
    expect(await codeOf(runForAccount(ACC_A, fn))).toBe('TENANT_CONTEXT_FORBIDDEN');
    expect(fn).not.toHaveBeenCalled();
  });

  it('ngữ cảnh request -> TENANT_CONTEXT_FORBIDDEN, không chạy fn', async () => {
    const fn = vi.fn(async () => 1);
    const code = await executionStorage.run(
      { traceId: 't', source: 'request', accountId: ACC_A },
      () => codeOf(runForAccount(ACC_A, fn)),
    );
    expect(code).toBe('TENANT_CONTEXT_FORBIDDEN');
    expect(fn).not.toHaveBeenCalled();
  });

  it('ngữ cảnh system -> TENANT_CONTEXT_FORBIDDEN', async () => {
    const code = await executionStorage.run({ traceId: 't', source: 'system' }, () =>
      codeOf(runForAccount(ACC_A, async () => 1)),
    );
    expect(code).toBe('TENANT_CONTEXT_FORBIDDEN');
  });

  it('trong job hợp lệ chạy được, đặt accountId, giữ traceId và jobId', async () => {
    const seen = await runWithJobContext({ traceId: 'trace-1', jobId: 'job-1' }, () =>
      runForAccount(ACC_A, async () => {
        const s = executionStorage.getStore();
        return { accountId: s?.accountId, traceId: s?.traceId, jobId: s?.jobId, source: s?.source };
      }),
    );
    expect(seen).toEqual({ accountId: ACC_A, traceId: 'trace-1', jobId: 'job-1', source: 'job' });
  });

  it('job đã gắn cùng tài khoản vẫn chạy được', async () => {
    const r = await runWithJobContext({ traceId: 't', accountId: ACC_A }, () =>
      runForAccount(ACC_A, async () => 'ok'),
    );
    expect(r).toBe('ok');
  });

  it('job đã gắn tài khoản khác -> TENANT_CONTEXT_CONFLICT', async () => {
    const fn = vi.fn(async () => 1);
    const code = await runWithJobContext({ traceId: 't', accountId: ACC_B }, () =>
      codeOf(runForAccount(ACC_A, fn)),
    );
    expect(code).toBe('TENANT_CONTEXT_CONFLICT');
    expect(fn).not.toHaveBeenCalled();
  });

  it('đang trong giao dịch -> TENANT_CONTEXT_CONFLICT', async () => {
    txState.tx = { role: 'system', accountId: null };
    const fn = vi.fn(async () => 1);
    const code = await runWithJobContext({ traceId: 't' }, () => codeOf(runForAccount(ACC_A, fn)));
    expect(code).toBe('TENANT_CONTEXT_CONFLICT');
    expect(fn).not.toHaveBeenCalled();
  });

  it('ngữ cảnh cha không bị đổi sau khi chạy xong', async () => {
    await runWithJobContext({ traceId: 't' }, async () => {
      await runForAccount(ACC_A, async () => 1);
      expect(executionStorage.getStore()?.accountId).toBeUndefined();
    });
  });
});
