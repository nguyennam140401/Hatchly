/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-empty-function -- các tập lệnh .mjs không có kiểu; kiểm thử dùng phản hồi giả */
import { describe, expect, it } from 'vitest';
import { resolve } from '../../ops/ci/scripts/resolve-gate-env.mjs';
import { buildMessage, mentions, sendTelegram } from '../../ops/ci/scripts/notify-telegram.mjs';
import { buildChecks, mergeReports } from '../../ops/ci/scripts/post-gate-checks.mjs';
import { laneSteps } from '../../ops/ci/scripts/lane-steps.mjs';
import { diffPaths, normalize, report } from '../../ops/ci/scripts/ruleset-drift.mjs';

// 008 T055/T059/T075: các tập lệnh của đường ống chạy với phản hồi GitHub / Telegram GIẢ (không gọi mạng thật).

type Fetch = (
  url: string,
  init?: unknown,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const reply = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });

/** GitHub giả: mỗi môi trường có danh sách Deployment mới → cũ và trạng thái của từng cái. */
function fakeGithub(data: Record<string, { id: number; sha: string; state: string }[]>): Fetch {
  return (url) => {
    const u = new URL(url);
    const environment = u.searchParams.get('environment');
    if (u.pathname.endsWith('/deployments') && environment) {
      return reply((data[environment] ?? []).map(({ id, sha }) => ({ id, sha })));
    }
    const m = /\/deployments\/(\d+)\/statuses/.exec(u.pathname);
    if (m) {
      const all = Object.values(data).flat();
      const found = all.find((d) => d.id === Number(m[1]));
      return reply(found ? [{ state: found.state }] : []);
    }
    return reply({}, 404);
  };
}

describe('resolve-gate-env', () => {
  const input = { target: 'dev', source: 'feature/x', sha: 'a'.repeat(40), repo: 'o/r' };

  it('đích dev → COMPAT_BASE_SHA là bản staging; bỏ qua lần triển khai chưa thành công', async () => {
    const fetchFn = fakeGithub({
      staging: [
        { id: 3, sha: 'bad', state: 'failure' },
        { id: 2, sha: 'good-staging', state: 'success' },
      ],
      production: [{ id: 9, sha: 'prod-sha', state: 'success' }],
    });
    const env = await resolve(input, { GITHUB_TOKEN: 't' }, fetchFn as never);
    expect(env).toEqual({
      STAGING_DEPLOYED_SHA: 'good-staging',
      COMPAT_BASE_SHA: 'good-staging',
      GATE_TARGET_BRANCH: 'dev',
      GATE_SOURCE_BRANCH: 'feature/x',
      MIGRATION_BASE_REF: 'origin/dev',
      APP_VERSION: 'a'.repeat(12),
    });
  });

  it('đích master → COMPAT_BASE_SHA là bản production; chưa từng triển khai → none', async () => {
    const withProd = await resolve(
      { ...input, target: 'master', source: 'dev' },
      { GITHUB_TOKEN: 't' },
      fakeGithub({
        staging: [{ id: 1, sha: 's', state: 'success' }],
        production: [{ id: 2, sha: 'p', state: 'success' }],
      }) as never,
    );
    expect(withProd.COMPAT_BASE_SHA).toBe('p');
    expect(withProd.MIGRATION_BASE_REF).toBe('origin/master');
    const none = await resolve(input, { GITHUB_TOKEN: 't' }, fakeGithub({}) as never);
    expect(none.STAGING_DEPLOYED_SHA).toBe('none');
    expect(none.COMPAT_BASE_SHA).toBe('none');
  });

  it('GitHub lỗi → ném lỗi (không đoán none), thông báo không chứa mã truy cập', async () => {
    const failing: Fetch = () => reply({}, 500);
    await expect(resolve(input, { GITHUB_TOKEN: 'ghs_SECRET' }, failing as never)).rejects.toThrow(
      /HTTP 500/,
    );
    await expect(
      resolve(input, { GITHUB_TOKEN: 'ghs_SECRET' }, failing as never),
    ).rejects.not.toThrow(/ghs_SECRET/);
  });
});

describe('ruleset-drift', () => {
  const want = {
    name: 'dev-protection',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/heads/dev'], exclude: [] } },
    bypass_actors: [],
    rules: [
      { type: 'deletion' },
      {
        type: 'required_status_checks',
        parameters: { required_status_checks: [{ context: 'ci/gates' }] },
      },
    ],
  };

  it('bỏ qua trường GitHub tự điền (id, integration_id) và thứ tự luật', () => {
    const actual = {
      ...want,
      id: 7,
      created_at: 'x',
      rules: [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'ci/gates', integration_id: 123 }] },
        },
        { type: 'deletion' },
      ],
    };
    expect(diffPaths(normalize(want), normalize(actual))).toEqual([]);
  });

  it('chỉ ra đúng trường lệch', () => {
    const actual = { ...want, enforcement: 'disabled' };
    expect(diffPaths(normalize(want), normalize(actual))).toEqual(['enforcement']);
    const missingRule = { ...want, rules: [{ type: 'deletion' }] };
    expect(diffPaths(normalize(want), normalize(missingRule)).length).toBeGreaterThan(0);
  });

  it('báo cáo nêu luật chưa áp và luật lệch', () => {
    const text = report([
      { name: 'a', status: 'ok', fields: [] },
      { name: 'b', status: 'missing', fields: [] },
      { name: 'c', status: 'drift', fields: ['enforcement'] },
    ]);
    expect(text).toContain('✔ a');
    expect(text).toContain('CHƯA được áp');
    expect(text).toContain('lệch ở enforcement');
  });
});

describe('notify-telegram', () => {
  const team = {
    members: [{ github: 'nam', telegram: 'nam_tg', roles: ['release-manager'] }],
    onCall: [],
  };

  it('bốn khuôn tin theo contracts/deploy-pipeline.md mục 8', () => {
    const base = {
      env: 'staging',
      sha: 'a1b2c3d4e5f6aaaa',
      author: 'nam',
      pr: '123',
      minutes: '9',
      migrations: '1',
      vulns: '0',
    };
    expect(buildMessage({ ...base, result: 'success' })).toContain(
      '✅ staging · thành công · a1b2c3d4e5f6',
    );
    expect(buildMessage({ ...base, result: 'failed', failedStep: 'migrate' })).toContain(
      '❌ staging · hỏng ở bước migrate (môi trường giữ nguyên)',
    );
    expect(buildMessage({ ...base, result: 'rolledback', failedStep: 'smoke' })).toContain(
      '⚠️ staging · ĐÃ QUAY VỀ BẢN TRƯỚC (hỏng ở smoke)',
    );
    expect(buildMessage({ ...base, result: 'noenv' })).toContain(
      'ℹ️ staging · chưa có môi trường đích',
    );
  });

  it('production hỏng/quay về → ưu tiên cao, nhắc người hợp nhất; thành công thì không', () => {
    const base = { env: 'production', sha: 'abc', author: 'nam' };
    const bad = buildMessage({ ...base, result: 'rolledback', failedStep: 'smoke' }, team);
    expect(bad.split('\n')[0]).toBe('🚨 ƯU TIÊN CAO @nam_tg');
    expect(buildMessage({ ...base, result: 'success' }, team)).not.toContain('ƯU TIÊN CAO');
    expect(mentions(team, 'nam')).toEqual(['@nam_tg']);
  });

  it('gửi lỗi: thử lại đủ số lần rồi trả ok=false; thành công ở lần thử lại thì dừng', async () => {
    let calls = 0;
    const flaky: Fetch = () => (++calls < 3 ? reply({}, 500) : reply({}));
    const ok = await sendTelegram(
      'x',
      { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' },
      [0, 0, 0],
      flaky as never,
    );
    expect(ok).toEqual({ ok: true, attempts: 3 });
    calls = 0;
    const down: Fetch = () => {
      calls++;
      return reply({}, 500);
    };
    const bad = await sendTelegram(
      'x',
      { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' },
      [0, 0, 0],
      down as never,
    );
    expect(bad.ok).toBe(false);
    expect(calls).toBe(4);
    expect((await sendTelegram('x', {}, [0])).ok).toBe(false);
  });
});

describe('post-gate-checks', () => {
  const ok = (name: string) => ({
    name,
    status: 'passed',
    seconds: 1,
    firstError: '',
    rerun: `pnpm verify --only ${name}`,
    note: '',
    exception: null,
  });

  it('gộp báo cáo: bước xấu hơn thắng; ci/gates chỉ xanh khi mọi báo cáo đạt', () => {
    const a = { mode: 'ci', passed: true, results: [ok('lint'), ok('test')] };
    const b = {
      mode: 'ci',
      passed: false,
      results: [{ ...ok('test:db'), status: 'failed', firstError: 'RLS lỗi' }],
    };
    const merged = mergeReports([a, b]);
    expect(merged.passed).toBe(false);
    const checks = buildChecks(merged, { buildUrl: 'https://ci/job/1/console' });
    expect(checks.map((c: { name: string }) => c.name)).toEqual([
      'gate/lint',
      'gate/test',
      'gate/test:db',
      'ci/gates',
    ]);
    expect(checks.at(-1)?.conclusion).toBe('failure');
  });

  it('gate không đạt hiện đủ bốn thứ của FR-010', () => {
    const merged = mergeReports([
      {
        mode: 'ci',
        passed: false,
        results: [
          { ...ok('check:secrets'), status: 'failed', firstError: 'ops/ci/x:3 – mã GitHub' },
        ],
      },
    ]);
    const failing = buildChecks(merged, { buildUrl: 'https://ci/job/7/console' })[0]!;
    expect(failing.summary).toContain('Cổng: check:secrets');
    expect(failing.summary).toContain('Dòng lỗi đầu: ops/ci/x:3 – mã GitHub');
    expect(failing.summary).toContain('Nhật ký: https://ci/job/7/console');
    expect(failing.summary).toContain('Chạy lại: pnpm verify --only check:secrets');
  });

  it('ngoại lệ → neutral kèm "VƯỢT CỔNG"; ci/gates vẫn đạt; skipped trên CI là không đạt', () => {
    const excepted = {
      ...ok('lint'),
      status: 'excepted',
      exception: { file: 'ops/ci/exceptions/x.yml', approvedBy: 'nam' },
    };
    const merged = mergeReports([{ mode: 'ci', passed: true, results: [excepted] }]);
    const checks = buildChecks(merged, { buildUrl: 'u' });
    expect(checks[0]).toMatchObject({
      conclusion: 'neutral',
      title: 'VƯỢT CỔNG (ngoại lệ) – duyệt bởi nam',
    });
    expect(checks.at(-1)?.conclusion).toBe('success');
    const skipped = mergeReports([
      { mode: 'ci', passed: true, results: [{ ...ok('test:db'), status: 'skipped' }] },
    ]);
    expect(skipped.passed).toBe(false);
  });
});

describe('lane-steps', () => {
  it('sắp theo order và báo lỗi khi làn không tồn tại', () => {
    const lanes = {
      lanes: {
        a: [
          { step: 'y', order: 20 },
          { step: 'x', order: 10 },
        ],
      },
    };
    expect(laneSteps(lanes, 'a')).toEqual(['x', 'y']);
    expect(() => laneSteps(lanes, 'b')).toThrow(/Không có làn/);
  });
});
