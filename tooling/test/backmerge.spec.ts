/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-empty-function -- các tập lệnh .mjs không có kiểu; kiểm thử dùng phản hồi giả */
import { describe, expect, it } from 'vitest';
import { backmerge } from '../../ops/ci/scripts/backmerge.mjs';
import { kindFor } from '../../ops/ci/scripts/deployment-record.mjs';
import { findReleasePullRequest } from '../../ops/ci/scripts/rerun-release-gates.mjs';

// 008 T084/T086/T087: GitHub GIẢ – tạo mới, đã tồn tại, xung đột; loại triển khai; tìm pull request phát hành.

const SHA = 'c'.repeat(40);
const MASTER = 'm'.repeat(40);

type Call = { method: string; path: string; body?: any };

/** GitHub giả: `open` = pull request backmerge đang mở, `mergeable` = trạng thái của pull request. */
function fakeGithub(opts: {
  branchExists?: boolean;
  open?: number[];
  mergeable?: boolean | null[];
}) {
  const calls: Call[] = [];
  const mergeableQueue = Array.isArray(opts.mergeable)
    ? [...opts.mergeable]
    : [opts.mergeable ?? true];
  const fetchFn = (async (url: string, init: any = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u.pathname + u.search, body });
    const reply = (status: number, json: unknown) => ({
      status,
      ok: status < 300,
      json: async () => json,
    });
    if (u.pathname.endsWith('/git/ref/heads/master'))
      return reply(200, { object: { sha: MASTER } });
    if (u.pathname.includes('/git/ref/heads/backmerge/'))
      return opts.branchExists ? reply(200, { object: { sha: MASTER } }) : reply(404, {});
    if (u.pathname.endsWith('/git/refs') && method === 'POST') return reply(201, {});
    if (u.pathname.endsWith('/pulls') && method === 'GET')
      return reply(
        200,
        (opts.open ?? []).map((number) => ({ number })),
      );
    if (u.pathname.endsWith('/pulls') && method === 'POST') return reply(201, { number: 99 });
    if (/\/pulls\/\d+$/.test(u.pathname))
      return reply(200, {
        mergeable: mergeableQueue.length > 1 ? mergeableQueue.shift() : mergeableQueue[0],
      });
    if (u.pathname.endsWith('/labels')) return reply(200, []);
    return reply(404, {});
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const run = (fake: ReturnType<typeof fakeGithub>) =>
  backmerge({ repo: 'o/r', sha: SHA, wait: async () => {} }, { GITHUB_TOKEN: 't' }, fake.fetchFn);

describe('backmerge', () => {
  it('tạo nhánh backmerge/<sha12> từ đầu master, mở pull request vào dev, gắn nhãn backmerge', async () => {
    const fake = fakeGithub({});
    expect(await run(fake)).toEqual({ pr: 99, conflict: false, created: true });
    const branch = fake.calls.find((c) => c.method === 'POST' && c.path.endsWith('/git/refs'))!;
    expect(branch.body).toEqual({ ref: `refs/heads/backmerge/${'c'.repeat(12)}`, sha: MASTER });
    const pr = fake.calls.find((c) => c.method === 'POST' && c.path.endsWith('/pulls'))!;
    expect(pr.body).toMatchObject({ title: `Backmerge sửa nóng ${'c'.repeat(12)}`, base: 'dev' });
    expect(fake.calls.find((c) => c.path.endsWith('/labels'))!.body).toEqual({
      labels: ['backmerge'],
    });
  });

  it('chạy lại: đã có nhánh và pull request → không tạo trùng', async () => {
    const fake = fakeGithub({ branchExists: true, open: [57] });
    expect(await run(fake)).toEqual({ pr: 57, conflict: false, created: false });
    expect(
      fake.calls.some(
        (c) => c.method === 'POST' && (c.path.endsWith('/pulls') || c.path.endsWith('/git/refs')),
      ),
    ).toBe(false);
  });

  it('xung đột → pull request VẪN mở, thêm nhãn needs-manual-merge', async () => {
    const fake = fakeGithub({ mergeable: false });
    const result = await run(fake);
    expect(result).toMatchObject({ pr: 99, conflict: true });
    expect(fake.calls.find((c) => c.path.endsWith('/labels'))!.body).toEqual({
      labels: ['backmerge', 'needs-manual-merge'],
    });
  });

  it('GitHub tính mergeable bất đồng bộ (null) → thăm dò tới khi có giá trị', async () => {
    const fake = fakeGithub({ mergeable: [null, null, false] as any });
    expect((await run(fake)).conflict).toBe(true);
  });

  it('lỗi API → ném lỗi nêu mã HTTP', async () => {
    const failing = (async () => ({
      status: 500,
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    await expect(
      backmerge({ repo: 'o/r', sha: SHA, wait: async () => {} }, { GITHUB_TOKEN: 't' }, failing),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe('loại triển khai (T086) và chạy lại cổng phát hành (T087)', () => {
  it('hotfix chỉ khi nhánh nguồn là hotfix/*', () => {
    expect(kindFor('hotfix/sua-loi-dang-nhap')).toBe('hotfix');
    expect(kindFor('dev')).toBe('release');
    expect(kindFor('feature/hotfix-x')).toBe('release');
    expect(kindFor(null)).toBe('release');
  });

  it('tìm pull request dev → master đang mở; không có thì null', async () => {
    const ok = (async () => ({
      ok: true,
      json: async () => [{ number: 12 }],
    })) as unknown as typeof fetch;
    const none = (async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch;
    expect(await findReleasePullRequest('o/r', { GITHUB_TOKEN: 't' }, ok)).toBe(12);
    expect(await findReleasePullRequest('o/r', { GITHUB_TOKEN: 't' }, none)).toBeNull();
    const bad = (async () => ({ ok: false, status: 502 })) as unknown as typeof fetch;
    await expect(findReleasePullRequest('o/r', { GITHUB_TOKEN: 't' }, bad)).rejects.toThrow(/502/);
  });
});
