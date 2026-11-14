/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-empty-function -- các tập lệnh .mjs không có kiểu; kiểm thử dùng phản hồi giả */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  buildRecord,
  createDeployment,
  statusFor,
} from '../../ops/ci/scripts/deployment-record.mjs';
import { renderValues } from '../../ops/deploy/scripts/render-values.mjs';
import { activate, prune, publish, rollback } from '../../ops/deploy/scripts/publish-web.mjs';
import { countCritical, releaseImage } from '../../ops/deploy/scripts/release-image.mjs';
import { runSmoke } from '../../ops/deploy/smoke/smoke.mjs';

// 008 T071–T076: tập lệnh triển khai chạy với kho tệp / máy chủ / kho ảnh GIẢ (không gọi dịch vụ thật).

const { parse } = createRequire(new URL('../package.json', import.meta.url))('yaml') as {
  parse: (s: string) => any;
};
const schema = JSON.parse(
  readFileSync(new URL('../../ops/deploy/env/schema.json', import.meta.url), 'utf8'),
);
const staging = parse(
  readFileSync(new URL('../../ops/deploy/env/staging.yaml', import.meta.url), 'utf8'),
);
const SHA = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;
const provisioned = {
  ...staging,
  provisioned: true,
  registry: { repository: 'registry.example.vn/app' },
  cluster: { server: 'https://k8s.example.vn', namespaces: { app: 'app', migrate: 'migrate' } },
  api: { baseUrl: 'https://api.test.example.vn' },
  web: {
    baseUrl: 'https://test.example.vn',
    bucket: 'web',
    s3Endpoint: 'https://s3.example.vn',
    s3Region: 'vn',
    buildEnv: {},
  },
  secrets: { app: 'app-secrets', dbOwner: 'db-owner' },
};

describe('render-values', () => {
  it('sinh giá trị Helm đúng bảng của hợp đồng', () => {
    expect(renderValues(provisioned, { env: 'staging', sha: SHA, digest: DIGEST }, schema)).toEqual(
      {
        image: { repository: 'registry.example.vn/app', digest: DIGEST },
        appVersion: SHA,
        replicas: { api: 1, worker: 1 },
        ingress: { host: 'api.test.example.vn' },
        envFromSecret: 'app-secrets',
        config: { APP_ENV: 'staging', CORS_ORIGINS: 'https://test.example.vn' },
      },
    );
  });

  it('từ chối: --env lệch name, môi trường chưa có, SHA/digest sai, sai lược đồ', () => {
    expect(() =>
      renderValues(provisioned, { env: 'production', sha: SHA, digest: DIGEST }, schema),
    ).toThrow(/không khớp/);
    expect(() =>
      renderValues(staging, { env: 'staging', sha: SHA, digest: DIGEST }, schema),
    ).toThrow();
    expect(() =>
      renderValues(provisioned, { env: 'staging', sha: 'abc', digest: DIGEST }, schema),
    ).toThrow(/SHA/);
    expect(() =>
      renderValues(provisioned, { env: 'staging', sha: SHA, digest: 'latest' }, schema),
    ).toThrow(/digest/);
    expect(() =>
      renderValues(
        { ...provisioned, replicas: { api: 0, worker: 1 } },
        { env: 'staging', sha: SHA, digest: DIGEST },
        schema,
      ),
    ).toThrow();
  });
});

/** Kho tệp tĩnh giả trong bộ nhớ, ghi lại thứ tự thao tác. */
function memoryStore() {
  const objects = new Map<string, { body: string; cacheControl: string }>();
  const log: string[] = [];
  return {
    objects,
    log,
    async put(key: string, body: Buffer | string, o: { cacheControl: string }) {
      log.push(key);
      objects.set(key, { body: body.toString(), cacheControl: o.cacheControl });
    },
    async get(key: string) {
      return objects.get(key)?.body;
    },
    async list(prefix: string) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix));
    },
    async remove(keys: string[]) {
      for (const k of keys) objects.delete(k);
    },
  };
}

function dist(name: string, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), `web-${name}-`));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

describe('publish-web', () => {
  const v1 = dist('v1', {
    'index.html': '<script src="/assets/app.aaa.js">',
    'assets/app.aaa.js': 'v1',
  });
  const v2 = dist('v2', {
    'index.html': '<script src="/assets/app.bbb.js">',
    'assets/app.bbb.js': 'v2',
  });

  it('assets immutable, index.html gốc chỉ ghi khi kích hoạt và là thao tác CUỐI', async () => {
    const store = memoryStore();
    await publish({ store, distDir: v1, sha: 'sha1' });
    expect(store.objects.get('assets/app.aaa.js')?.cacheControl).toContain('immutable');
    expect(store.objects.has('index.html')).toBe(false);
    expect(store.objects.has('releases/sha1/index.html')).toBe(true);
    store.log.length = 0;
    await activate({ store, sha: 'sha1' });
    expect(store.log.at(-1)).toBe('index.html');
    expect(store.objects.get('index.html')?.cacheControl).toBe('no-cache');
  });

  it('bản mới không xóa tệp cũ; quay về chép lại index.html cũ; chạy lại cho cùng kết quả', async () => {
    const store = memoryStore();
    await publish({ store, distDir: v1, sha: 'sha1' });
    await activate({ store, sha: 'sha1' });
    await publish({ store, distDir: v2, sha: 'sha2' });
    await activate({ store, sha: 'sha2' });
    expect(store.objects.has('assets/app.aaa.js')).toBe(true);
    expect(store.objects.get('index.html')?.body).toContain('bbb');
    await rollback({ store, sha: 'sha1' });
    expect(store.objects.get('index.html')?.body).toContain('aaa');
    const before = JSON.stringify([...store.objects]);
    await activate({ store, sha: 'sha1' });
    await activate({ store, sha: 'sha1' });
    expect(JSON.parse(JSON.stringify([...store.objects])).length).toBe(JSON.parse(before).length);
  });

  it('dọn theo manifest: giữ assets của bản hiện hành và bản kích hoạt ≤ 7 ngày, xóa phần còn lại', async () => {
    const store = memoryStore();
    const day = 86_400_000;
    const t0 = new Date('2026-11-01T00:00:00Z');
    await publish({ store, distDir: v1, sha: 'sha1', now: t0 });
    await activate({ store, sha: 'sha1', now: t0 });
    await publish({ store, distDir: v2, sha: 'sha2', now: new Date(t0.getTime() + 10 * day) });
    await activate({ store, sha: 'sha2', now: new Date(t0.getTime() + 10 * day) });
    store.objects.set('assets/orphan.js', { body: 'x', cacheControl: 'x' });
    const result = await prune({ store, now: new Date(t0.getTime() + 11 * day) });
    expect(result.deleted.sort()).toEqual(['assets/app.aaa.js', 'assets/orphan.js']);
    expect(store.objects.has('assets/app.bbb.js')).toBe(true);
    // Trong cửa sổ 7 ngày bản cũ còn được giữ.
    const keep = await prune({ store, now: new Date(t0.getTime() + 11 * day) });
    expect(keep.deleted).toEqual([]);
  });

  it('không kích hoạt được bản đã bị dọn assets; chưa kích hoạt bản nào thì không dọn gì', async () => {
    const store = memoryStore();
    await publish({ store, distDir: v1, sha: 'sha1' });
    expect((await prune({ store })).deleted).toEqual([]);
    store.objects.delete('assets/app.aaa.js');
    await expect(activate({ store, sha: 'sha1' })).rejects.toThrow(/thiếu 1 tệp assets/);
  });
});

describe('smoke', () => {
  const html = '<html><script type="module" src="/assets/main.js"></script></html>';
  type H = { status: number; json?: unknown; text?: string; cookies?: string[] };
  const make = (routes: Record<string, H | ((init?: any) => H)>) =>
    (async (url: string, init?: any) => {
      const u = new URL(url);
      const r = routes[`${init?.method ?? 'GET'} ${u.pathname}`];
      const h = typeof r === 'function' ? r(init) : r;
      if (!h)
        return {
          status: 404,
          json: async () => ({}),
          text: async () => '',
          headers: { getSetCookie: () => [] },
        };
      return {
        status: h.status,
        json: async () => h.json,
        text: async () => h.text ?? '',
        headers: { getSetCookie: () => h.cookies ?? [] },
      };
    }) as unknown as typeof fetch;
  const base = {
    apiBase: 'https://api.t',
    webBase: 'https://web.t',
    expect: SHA,
    token: 'tok',
    user: 'u@x',
    password: 'p',
    deadline: 0,
  };
  const healthy = (overrides: Record<string, H> = {}) =>
    make({
      'GET /healthz': { status: 200, json: { version: SHA } },
      'GET /readyz': { status: 200, json: {} },
      'POST /api/v1/ops/smoke': { status: 202, json: { id: 'id1' } },
      'GET /api/v1/ops/smoke/id1': {
        status: 200,
        json: { processedAt: 't', apiVersion: SHA, workerVersion: SHA },
      },
      'POST /api/v1/auth/login': { status: 200, cookies: ['s=1; Path=/'] },
      'POST /api/v1/auth/logout': { status: 204 },
      'GET /': { status: 200, text: html },
      [`GET /releases/${SHA}/index.html`]: { status: 200, text: html },
      'GET /assets/main.js': { status: 200 },
      ...overrides,
    });

  it('đạt cả bốn mục khi mọi thứ khớp', async () => {
    let now = 0;
    const r = await runSmoke({
      ...base,
      deadline: 60_000,
      fetchFn: healthy(),
      now: () => now,
      wait: async (ms) => void (now += ms),
    });
    expect(r.map((x) => `${x.name}:${x.ok}`)).toEqual([
      'api.health:true',
      'db+queue:true',
      'login:true',
      'web:true',
    ]);
  });

  it('lệch phiên bản → không đạt', async () => {
    const r = await runSmoke({
      ...base,
      deadline: 60_000,
      fetchFn: healthy({ 'GET /healthz': { status: 200, json: { version: 'khac' } } }),
      now: () => 0,
      wait: async () => {},
    });
    expect(r[0]).toMatchObject({ name: 'api.health', ok: false });
    expect(r[0]!.detail).toContain('khác'.length > 0 ? 'phiên bản' : '');
  });

  it('processedAt không bao giờ có → db+queue không đạt khi hết hạn', async () => {
    let now = 0;
    const r = await runSmoke({
      ...base,
      deadline: 5000,
      fetchFn: healthy({
        'GET /api/v1/ops/smoke/id1': {
          status: 200,
          json: { processedAt: null, apiVersion: SHA, workerVersion: null },
        },
      }),
      now: () => now,
      wait: async (ms) => void (now += ms),
    });
    expect(r[1]).toMatchObject({ name: 'db+queue', ok: false });
  });

  it('worker khác phiên bản, web không HTTPS, thiếu mã → không đạt đúng mục, không in giá trị bí mật', async () => {
    const wrongWorker = await runSmoke({
      ...base,
      deadline: 60_000,
      fetchFn: healthy({
        'GET /api/v1/ops/smoke/id1': {
          status: 200,
          json: { processedAt: 't', apiVersion: SHA, workerVersion: 'cu' },
        },
      }),
      now: () => 0,
      wait: async () => {},
    });
    expect(wrongWorker[1]!.ok).toBe(false);
    const noToken = await runSmoke({
      ...base,
      token: undefined,
      deadline: 1000,
      fetchFn: healthy(),
      now: () => 0,
      wait: async () => {},
    });
    expect(noToken[1]).toMatchObject({ ok: false, detail: 'thiếu SMOKE_TOKEN' });
    const http = await runSmoke({
      ...base,
      webBase: 'http://web.t',
      deadline: 1000,
      fetchFn: healthy(),
      now: () => 0,
      wait: async () => {},
    });
    expect(http[3]!.ok).toBe(false);
    const all = JSON.stringify([wrongWorker, noToken, http]);
    expect(all).not.toContain('tok"');
    expect(all).not.toContain('"p"');
  });
});

describe('deployment-record', () => {
  const input = {
    environment: 'staging',
    kind: 'release',
    commit: SHA,
    image: { repository: 'r', digest: DIGEST, reused: true },
    mergedBy: 'nam',
    approvedBy: [],
    pullRequest: 7,
    jenkins: { job: 'deploy/staging/deploy', build: 3, url: 'https://ci/job/3/' },
    gates: { passed: true, excepted: [] },
    vulnerabilities: { critical: 0, criticalFixable: 0, blocked: false },
    migrations: ['0014_x.sql'],
    steps: [{ name: 'gates', status: 'passed', seconds: 1 }],
  };

  it('ánh xạ kết quả → trạng thái GitHub; no_target không tạo Deployment', () => {
    expect(statusFor('succeeded')).toMatchObject({ state: 'success' });
    expect(statusFor('rolled_back')).toMatchObject({
      state: 'failure',
      description: 'Đã quay về bản trước',
    });
    expect(statusFor('stopped_before_change', 'migrate')!.description).toContain('migrate');
    expect(statusFor('no_target')).toBeNull();
  });

  it('bản ghi đúng lược đồ (schema 1) và từ chối giá trị sai', () => {
    const rec = buildRecord(input);
    expect(rec).toMatchObject({
      schema: 1,
      environment: 'staging',
      kind: 'release',
      rolledBack: false,
      previous: null,
      redeploy: null,
      notifyErrors: [],
    });
    expect(() => buildRecord({ ...input, environment: 'dev' })).toThrow();
    expect(() => buildRecord({ ...input, kind: 'x' })).toThrow();
    expect(() => buildRecord({ ...input, commit: 'abc' })).toThrow();
  });

  it('createDeployment gọi đúng API; no_target không gọi gì', async () => {
    const calls: { url: string; body: any }[] = [];
    const fetchFn = (async (url: string, init: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      return { ok: true, status: 201, json: async () => ({ id: 42 }) };
    }) as unknown as typeof fetch;
    const rec = buildRecord(input);
    const id = await createDeployment(
      { repo: 'o/r', record: rec, result: 'succeeded', logUrl: 'https://ci/x' },
      { GITHUB_TOKEN: 't' },
      fetchFn,
    );
    expect(id).toBe(42);
    expect(calls[0]!.body).toMatchObject({
      ref: SHA,
      environment: 'staging',
      auto_merge: false,
      payload: { schema: 1 },
    });
    expect(calls[1]!.body).toMatchObject({ state: 'success' });
    calls.length = 0;
    expect(
      await createDeployment(
        { repo: 'o/r', record: rec, result: 'no_target' },
        { GITHUB_TOKEN: 't' },
        fetchFn,
      ),
    ).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe('release-image', () => {
  const trivy = (vulns: object[]) => JSON.stringify({ Results: [{ Vulnerabilities: vulns }] });
  const runner = (opts: { exists: boolean; scan: string }) => {
    const calls: string[][] = [];
    const run = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (args[0] === 'manifest') return { status: opts.exists ? 0 : 1, stdout: '' };
      if (args[0] === 'buildx' && args[1] === 'build') return { status: 0, stdout: '' };
      if (args[0] === 'buildx') return { status: 0, stdout: `${DIGEST}\n` };
      return { status: 0, stdout: opts.scan };
    };
    return { run, calls };
  };

  it('thẻ đã có → dùng lại, KHÔNG dựng/đẩy đè', () => {
    const { run, calls } = runner({ exists: true, scan: trivy([]) });
    const r = releaseImage({ repository: 'r', sha: SHA, policy: 'block', run });
    expect(r).toMatchObject({ reused: true, digest: DIGEST });
    expect(calls.some((c) => c[1] === 'buildx' && c[2] === 'build')).toBe(false);
  });

  it('thẻ chưa có → dựng với APP_VERSION=<sha> rồi đẩy', () => {
    const { run, calls } = runner({ exists: false, scan: trivy([]) });
    const r = releaseImage({ repository: 'r', sha: SHA, policy: 'warn', run });
    expect(r.reused).toBe(false);
    const build = calls.find((c) => c[1] === 'buildx' && c[2] === 'build')!;
    expect(build).toContain(`APP_VERSION=${SHA}`);
    expect(build).toContain('--push');
  });

  it('chính sách: block chặn khi có lỗ hổng nghiêm trọng ĐÃ CÓ BẢN VÁ; warn chỉ đếm; chưa có bản vá không chặn', () => {
    const fixable = trivy([
      { Severity: 'CRITICAL', FixedVersion: '1.2' },
      { Severity: 'HIGH', FixedVersion: '1' },
    ]);
    const unfixed = trivy([{ Severity: 'CRITICAL' }]);
    expect(
      releaseImage({
        repository: 'r',
        sha: SHA,
        policy: 'block',
        run: runner({ exists: true, scan: fixable }).run,
      }).vulnerabilities,
    ).toEqual({ critical: 1, criticalFixable: 1, blocked: true });
    expect(
      releaseImage({
        repository: 'r',
        sha: SHA,
        policy: 'warn',
        run: runner({ exists: true, scan: fixable }).run,
      }).vulnerabilities.blocked,
    ).toBe(false);
    expect(
      releaseImage({
        repository: 'r',
        sha: SHA,
        policy: 'block',
        run: runner({ exists: true, scan: unfixed }).run,
      }).vulnerabilities,
    ).toEqual({ critical: 1, criticalFixable: 0, blocked: false });
    expect(countCritical({})).toEqual({ critical: 0, criticalFixable: 0 });
  });
});
