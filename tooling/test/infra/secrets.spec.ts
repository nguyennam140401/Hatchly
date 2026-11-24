import { describe, expect, it } from 'vitest';
import {
  allowedKeys,
  assertKeyAllowed,
  dbUrl,
  secretsInit,
  secretsList,
  secretsRotate,
  secretsSet,
} from '../../infra/commands/secrets.mjs';

// T054/T055 (007, FR-014, R8): Secret tạo một lần, không đổi khi chạy lại, không lộ giá trị, đúng khóa đúng chỗ.

interface StoredSecret {
  data: Record<string, string>;
  annotations: Record<string, string>;
  type?: string;
}

function fakeKube(seed: Record<string, Record<string, string>> = {}) {
  const store = new Map<string, StoredSecret>();
  for (const [name, data] of Object.entries(seed)) store.set(name, { data, annotations: {} });
  const execCalls: { args: string[]; input: string }[] = [];
  return {
    store,
    execCalls,
    secretKeys: (_ns: string, name: string) =>
      Promise.resolve(store.has(name) ? Object.keys(store.get(name)?.data ?? {}).sort() : null),
    secretValues: (_ns: string, name: string) => Promise.resolve(store.get(name)?.data ?? null),
    secretAnnotations: (_ns: string, name: string) =>
      Promise.resolve(store.get(name)?.annotations ?? null),
    patchSecretKey: (
      _ns: string,
      name: string,
      key: string,
      value: string,
      options: { annotations?: Record<string, string>; type?: string } = {},
    ) => {
      const secret = store.get(name) ?? { data: {}, annotations: {} };
      secret.data[key] = value;
      secret.annotations = { ...secret.annotations, ...options.annotations };
      if (options.type !== undefined) secret.type = options.type;
      store.set(name, secret);
      return Promise.resolve('');
    },
    get: (kind: string) =>
      Promise.resolve(kind.startsWith('cluster') ? { status: { currentPrimary: 'pg-1' } } : null),
    exec: (args: string[], input: string) => {
      execCalls.push({ args, input });
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    },
  };
}

function capture() {
  const lines: string[] = [];
  return { lines, log: (m: string) => lines.push(m) };
}

const counter = (start = 0) => {
  let n = start;
  return (size: number) => Buffer.alloc(size, (n += 1));
};

describe('secrets init', () => {
  it('tạo đủ khóa ở đúng Secret và chạy lại không đổi gì', async () => {
    const kube = fakeKube({ 'pg-superuser': { username: 'postgres', password: 'su-pass' } });
    const out = capture();
    const created = await secretsInit('staging', { kube, rng: counter(), log: out.log });
    expect(created).toBeGreaterThan(8);
    const keys = (name: string) => Object.keys(kube.store.get(name)?.data ?? {}).sort();
    expect(keys('api-secrets')).toEqual([
      'AUTH_THROTTLE_SECRET',
      'DATABASE_APP_URL',
      'DATABASE_SUPPORT_URL',
    ]);
    expect(keys('worker-secrets')).toEqual(['DATABASE_APP_URL', 'DATABASE_SYSTEM_URL']);
    expect(keys('migrate-secrets')).toEqual(
      expect.arrayContaining(['DATABASE_ADMIN_URL', 'DATABASE_OWNER_URL', 'DB_ROLE_PASSWORD_APP']),
    );

    const snapshot = JSON.stringify([...kube.store.entries()]);
    const again = await secretsInit('staging', { kube, rng: counter(100), log: capture().log });
    expect(again).toBe(0);
    expect(JSON.stringify([...kube.store.entries()])).toBe(snapshot);
  });

  it('FR-014: api-secrets không có OWNER/ADMIN/SYSTEM; worker-secrets không có OWNER/ADMIN', async () => {
    const kube = fakeKube({ 'pg-superuser': { username: 'postgres', password: 'su-pass' } });
    await secretsInit('staging', { kube, rng: counter(), log: capture().log });
    const api = Object.keys(kube.store.get('api-secrets')?.data ?? {});
    const worker = Object.keys(kube.store.get('worker-secrets')?.data ?? {});
    for (const forbidden of ['DATABASE_OWNER_URL', 'DATABASE_ADMIN_URL', 'DATABASE_SYSTEM_URL']) {
      expect(api).not.toContain(forbidden);
    }
    for (const forbidden of ['DATABASE_OWNER_URL', 'DATABASE_ADMIN_URL']) {
      expect(worker).not.toContain(forbidden);
    }
  });

  it('không giá trị nào xuất hiện trong đầu ra, mọi khóa mới đánh dấu nguồn generated', async () => {
    const kube = fakeKube({ 'pg-superuser': { username: 'postgres', password: 'su-pass' } });
    const out = capture();
    await secretsInit('staging', { kube, rng: counter(), log: out.log });
    const printed = out.lines.join('\n');
    for (const secret of kube.store.values()) {
      for (const value of Object.values(secret.data)) {
        if (value.length > 6) expect(printed).not.toContain(value);
      }
    }
    expect(kube.store.get('api-secrets')?.annotations['infra/source']).toBe('generated');
    expect(kube.store.get('api-secrets')?.annotations['infra/rotated-at']).toBeDefined();
  });

  it('chưa có pg-superuser → bỏ DATABASE_ADMIN_URL, nói rõ, lần sau bổ sung', async () => {
    const kube = fakeKube();
    const out = capture();
    await secretsInit('staging', { kube, rng: counter(), log: out.log });
    expect(kube.store.get('migrate-secrets')?.data.DATABASE_ADMIN_URL).toBeUndefined();
    expect(out.lines.join('\n')).toMatch(/pg-superuser chưa có/);

    kube.store.set('pg-superuser', {
      data: { username: 'postgres', password: 'su-pass' },
      annotations: {},
    });
    await secretsInit('staging', { kube, rng: counter(50), log: capture().log });
    expect(kube.store.get('migrate-secrets')?.data.DATABASE_ADMIN_URL).toContain(
      'postgres://postgres:',
    );
  });

  it('chuỗi kết nối dùng pg-rw.database.svc và sslmode=require', () => {
    expect(dbUrl('app', 'p@ss/word')).toBe(
      'postgres://app:p%40ss%2Fword@pg-rw.database.svc:5432/app?sslmode=require',
    );
  });
});

describe('bất biến FR-014 khi ghi', () => {
  it.each([
    ['api-secrets', 'DATABASE_OWNER_URL'],
    ['api-secrets', 'DATABASE_ADMIN_URL'],
    ['api-secrets', 'DATABASE_SYSTEM_URL'],
    ['worker-secrets', 'DATABASE_OWNER_URL'],
    ['worker-secrets', 'DATABASE_ADMIN_URL'],
  ])('từ chối ghi %s/%s (thoát 3)', (secret, key) => {
    try {
      assertKeyAllowed(secret, key);
      expect.unreachable();
    } catch (error) {
      expect((error as { exit: number }).exit).toBe(3);
    }
  });

  it('từ chối khóa lạ và Secret lạ', () => {
    expect(() => {
      assertKeyAllowed('api-secrets', 'RANDOM_KEY');
    }).toThrow(/không thuộc/);
    expect(() => {
      assertKeyAllowed('khong-co', 'X');
    }).toThrow(/không có trong danh sách/);
  });

  it('`set` cũng bị chặn và không ghi gì', async () => {
    const kube = fakeKube();
    await expect(
      secretsSet('staging', 'api-secrets', 'DATABASE_OWNER_URL', {
        kube,
        askHidden: () => Promise.resolve('x'),
        log: capture().log,
      }),
    ).rejects.toMatchObject({ exit: 3 });
    expect(kube.store.size).toBe(0);
  });
});

describe('secrets set / list', () => {
  it('set ghi giá trị nhập tay, đánh dấu external, không in giá trị', async () => {
    const kube = fakeKube();
    const out = capture();
    await secretsSet('staging', 'api-secrets', 'S3_SECRET_ACCESS_KEY', {
      kube,
      askHidden: () => Promise.resolve('super-secret-value-123'),
      log: out.log,
    });
    expect(kube.store.get('api-secrets')?.data.S3_SECRET_ACCESS_KEY).toBe('super-secret-value-123');
    expect(kube.store.get('api-secrets')?.annotations['infra/source']).toBe('external');
    expect(out.lines.join('\n')).not.toContain('super-secret-value-123');
  });

  it('registry-pull dựng .dockerconfigjson đúng kiểu Secret', async () => {
    const kube = fakeKube();
    await secretsSet('staging', 'registry-pull', '.dockerconfigjson', {
      kube,
      ask: () => Promise.resolve('robot$pull-staging'),
      askHidden: () => Promise.resolve('robot-pass-xyz'),
      registryServer: 'vcr.example.test',
      log: capture().log,
    });
    const stored = kube.store.get('registry-pull');
    expect(stored?.type).toBe('kubernetes.io/dockerconfigjson');
    const parsed = JSON.parse(stored?.data['.dockerconfigjson'] ?? '{}') as {
      auths: Record<string, { username: string }>;
    };
    expect(parsed.auths['vcr.example.test']?.username).toBe('robot$pull-staging');
  });

  it('list chỉ có tên, khóa, nguồn, thời điểm xoay – không giá trị', async () => {
    const kube = fakeKube({ 'pg-superuser': { username: 'postgres', password: 'su-pass' } });
    await secretsInit('staging', { kube, rng: counter(), log: capture().log });
    const out = capture();
    await secretsList('staging', { kube, log: out.log });
    const printed = out.lines.join('\n');
    expect(printed).toContain('api-secrets');
    expect(printed).toContain('AUTH_THROTTLE_SECRET');
    expect(printed).toContain('nguồn=generated');
    for (const secret of kube.store.values()) {
      for (const value of Object.values(secret.data)) {
        if (value.length > 6) expect(printed).not.toContain(value);
      }
    }
  });
});

describe('015 T049c: khóa nhà cung cấp AI', () => {
  const AI_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

  it('allowedKeys của api-secrets và worker-secrets chứa cả hai khóa; migrate-secrets thì không', () => {
    for (const key of AI_KEYS) {
      expect(allowedKeys('api-secrets'), key).toContain(key);
      expect(allowedKeys('worker-secrets'), key).toContain(key);
      expect(allowedKeys('migrate-secrets'), key).not.toContain(key);
      expect(() => {
        assertKeyAllowed('api-secrets', key);
        assertKeyAllowed('worker-secrets', key);
      }).not.toThrow();
    }
  });

  it('secrets init KHÔNG tự tạo khóa AI (nhập tay bằng `secrets set`), kể cả khi chạy lại', async () => {
    const kube = fakeKube({ 'pg-superuser': { username: 'postgres', password: 'su-pass' } });
    await secretsInit('staging', { kube, rng: counter(), log: capture().log });
    await secretsInit('staging', { kube, rng: counter(100), log: capture().log });
    for (const secret of ['api-secrets', 'worker-secrets']) {
      const keys = Object.keys(kube.store.get(secret)?.data ?? {});
      for (const key of AI_KEYS) expect(keys, `${secret}/${key}`).not.toContain(key);
    }
  });

  it('secrets set ghi được khóa AI vào cả hai Secret, đánh dấu external, không in giá trị', async () => {
    const kube = fakeKube();
    const out = capture();
    for (const secret of ['api-secrets', 'worker-secrets']) {
      for (const key of AI_KEYS) {
        await secretsSet('staging', secret, key, {
          kube,
          askHidden: () => Promise.resolve('sk-ai-test-value-987654321'),
          log: out.log,
        });
        expect(kube.store.get(secret)?.data[key]).toBe('sk-ai-test-value-987654321');
        expect(kube.store.get(secret)?.annotations['infra/source']).toBe('external');
      }
    }
    expect(out.lines.join('\n')).not.toContain('sk-ai-test-value-987654321');
  });

  it('khóa AI bị từ chối ở migrate-secrets (thoát 3, không ghi gì)', async () => {
    const kube = fakeKube();
    await expect(
      secretsSet('staging', 'migrate-secrets', 'ANTHROPIC_API_KEY', {
        kube,
        askHidden: () => Promise.resolve('x'),
        log: capture().log,
      }),
    ).rejects.toMatchObject({ exit: 3 });
    expect(kube.store.size).toBe(0);
  });
});

describe('secrets rotate', () => {
  it('db-app: đổi mật khẩu CSDL qua stdin rồi cập nhật mọi Secret chứa chuỗi kết nối', async () => {
    const kube = fakeKube({ 'pg-superuser': { username: 'postgres', password: 'su-pass' } });
    await secretsInit('staging', { kube, rng: counter(), log: capture().log });
    const before = kube.store.get('api-secrets')?.data.DATABASE_APP_URL;
    const out = capture();
    await secretsRotate('staging', 'db-app', { kube, rng: counter(200), log: out.log });

    expect(kube.execCalls).toHaveLength(1);
    expect(kube.execCalls[0]?.input).toMatch(/^ALTER ROLE app WITH PASSWORD '/);
    expect(kube.execCalls[0]?.args.join(' ')).not.toMatch(/PASSWORD/);
    expect(kube.store.get('api-secrets')?.data.DATABASE_APP_URL).not.toBe(before);
    expect(kube.store.get('worker-secrets')?.data.DATABASE_APP_URL).toBe(
      kube.store.get('api-secrets')?.data.DATABASE_APP_URL,
    );
    expect(out.lines.join('\n')).toMatch(/rollout restart/);
    expect(out.lines.join('\n')).not.toContain(
      kube.store.get('migrate-secrets')?.data.DB_ROLE_PASSWORD_APP ?? 'x',
    );
  });

  it('auth-throttle chỉ đổi một khóa, không đụng CSDL', async () => {
    const kube = fakeKube();
    await secretsRotate('staging', 'auth-throttle', { kube, rng: counter(), log: capture().log });
    expect(kube.execCalls).toHaveLength(0);
    expect(kube.store.get('api-secrets')?.data.AUTH_THROTTLE_SECRET).toBeDefined();
  });

  it('tên xoay lạ → lỗi', async () => {
    await expect(
      secretsRotate('staging', 'khong-co', { kube: fakeKube(), log: capture().log }),
    ).rejects.toThrow(/không hợp lệ/);
  });
});
