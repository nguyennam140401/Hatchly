import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectDrift, run } from '../../infra/commands/drift.mjs';

// T097 (007): drift chỉ đọc, đúng phạm vi stack, mã thoát đúng.

interface Call {
  stack: string;
  args: string[];
}

function harness(
  opts: { exitFor?: Record<string, number>; plan?: unknown; powered?: boolean } = {},
) {
  const calls: Call[] = [];
  const terraform = {
    init: () => Promise.resolve(),
    tf: (stack: string, args: string[]) => {
      calls.push({ stack, args });
      return Promise.resolve({ code: opts.exitFor?.[stack] ?? 0, stdout: '', stderr: 'boom' });
    },
    showJson: () => Promise.resolve(opts.plan ?? {}),
  };
  const deps = {
    openSession: () => Promise.resolve({ env: 'staging', procEnv: {} }),
    readPowered: () => Promise.resolve(opts.powered ?? true),
    terraform,
  };
  return { calls, deps };
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const log = console.log;
  const err = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = err;
  }
};

describe('drift', () => {
  it('--stack cloud chỉ chạy stack cloud; không tùy chọn thì chạy cả hai', async () => {
    const a = harness();
    await quiet(() => run({ env: 'staging', flags: { stack: 'cloud' } }, a.deps));
    expect(a.calls.map((c) => c.stack)).toEqual(['cloud']);
    const b = harness();
    await quiet(() => run({ env: 'staging', flags: {} }, b.deps));
    expect(b.calls.map((c) => c.stack)).toEqual(['cloud', 'platform']);
  });

  it('không lệch → 0; có lệch → 2; lỗi chạy → 1', async () => {
    expect(await quiet(() => run({ env: 'staging', flags: {} }, harness().deps))).toBe(0);
    const drift = {
      resource_drift: [
        {
          address: 'module.provider.vngcloud_vserver_secgrouprule.ingress["x"]',
          change: {
            before: { remote_ip_prefix: '10.0.0.0/24' },
            after: { remote_ip_prefix: '0.0.0.0/0' },
          },
        },
      ],
    };
    const changed = harness({ exitFor: { cloud: 2 }, plan: drift });
    expect(
      await quiet(() => run({ env: 'staging', flags: { stack: 'cloud' } }, changed.deps)),
    ).toBe(2);
    expect(
      await quiet(() =>
        run({ env: 'staging', flags: {} }, harness({ exitFor: { cloud: 1 } }).deps),
      ),
    ).toBe(1);
  });

  it('in địa chỉ: thuộc tính lệch', () => {
    const items = collectDrift(
      { resource_drift: [{ address: 'a.b', change: { before: { p: 1 }, after: { p: 2 } } }] },
      'cloud',
    ) as { address: string; attribute: string }[];
    expect(items).toMatchObject([{ address: 'a.b', attribute: 'p' }]);
  });

  it('không bao giờ gọi apply; máy tắt thì truyền powered=false và bỏ qua platform', async () => {
    const h = harness({ powered: false });
    await quiet(() => run({ env: 'staging', flags: {} }, h.deps));
    expect(h.calls.map((c) => c.stack)).toEqual(['cloud']);
    expect(h.calls[0]?.args).toContain('-var=powered=false');
    for (const c of h.calls) expect(c.args[0]).toBe('plan');
    const source = readFileSync(
      join(__dirname, '..', '..', 'infra', 'commands', 'drift.mjs'),
      'utf8',
    );
    expect(source).not.toMatch(/applyFile|'apply'/);
    expect(readdirSync(join(__dirname, '..', '..', 'infra', 'commands'))).toContain('drift.mjs');
  });
});
