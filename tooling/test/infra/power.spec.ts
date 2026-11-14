import { describe, expect, it } from 'vitest';
import { run as plan } from '../../infra/commands/plan.mjs';
import { assertMayPower, run as power } from '../../infra/commands/power.mjs';
import { readPowered } from '../../infra/lib/runtime-state.mjs';

// T063 (007, FR-034): chỉ thử nghiệm được tắt/bật; power_lock chặn; runtime/power.json được truyền thành -var powered.

const rejectsWithExit = async (promise: Promise<unknown>, exit: number, message?: RegExp) => {
  try {
    await promise;
    expect.unreachable();
  } catch (error) {
    expect((error as { exit: number }).exit).toBe(exit);
    if (message !== undefined) expect((error as Error).message).toMatch(message);
  }
};

describe('power', () => {
  it('power production off → thoát 3', async () => {
    await rejectsWithExit(
      power({ env: 'production', args: ['off'] }, { tfvars: {} }),
      3,
      /thử nghiệm/,
    );
  });

  it('power_lock = true → thoát 3 kèm lý do Meta xét duyệt', async () => {
    await rejectsWithExit(
      power({ env: 'staging', args: ['off'] }, { tfvars: { power_lock: true } }),
      3,
      /Meta xét duyệt/,
    );
  });

  it('power_lock chỉ chặn `off`, không chặn `on`', () => {
    expect(() => {
      assertMayPower('staging', 'on', { power_lock: true });
    }).not.toThrow();
    expect(() => {
      assertMayPower('staging', 'off', { power_lock: false });
    }).not.toThrow();
  });

  it('đối số lạ → lỗi cú pháp', async () => {
    await rejectsWithExit(power({ env: 'staging', args: ['sideways'] }, { tfvars: {} }), 1);
  });
});

describe('runtime/power.json → -var powered', () => {
  const fakeS3 = (state: unknown) => ({ getJson: () => Promise.resolve(state) });

  it('readPowered: mặc định bật; đọc false từ tệp; production luôn bật', async () => {
    expect(await readPowered('staging', { s3: fakeS3(null) })).toBe(true);
    expect(await readPowered('staging', { s3: fakeS3({ powered: false }) })).toBe(false);
    expect(await readPowered('staging', { s3: fakeS3({ powered: true }) })).toBe(true);
    expect(await readPowered('production', { s3: fakeS3({ powered: false }) })).toBe(true);
  });

  it('plan truyền -var powered=false cho stack cloud và bỏ qua stack platform khi máy tắt', async () => {
    const calls: { stack: string; vars: Record<string, string> }[] = [];
    const terraform = {
      withLock: (_s: string, _e: string, fn: () => Promise<unknown>) => fn(),
      init: () => Promise.resolve(),
      planToFile: (
        stack: string,
        _e: string,
        _f: string,
        options: { vars: Record<string, string> },
      ) => {
        calls.push({ stack, vars: options.vars });
        return Promise.resolve({ code: 0 });
      },
      showJson: () => Promise.resolve({ resource_changes: [] }),
    };
    const code = await plan(
      { env: 'staging', args: [], flags: {} },
      {
        assertCleanTree: () => Promise.resolve(),
        openSession: () => Promise.resolve({ env: 'staging', procEnv: {} }),
        readPowered: () => readPowered('staging', { s3: fakeS3({ powered: false }) }),
        terraform,
      },
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ stack: 'cloud', vars: { powered: 'false' } });
  });
});
