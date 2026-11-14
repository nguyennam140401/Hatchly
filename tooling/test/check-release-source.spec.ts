import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkReleaseSource } from '../check-release-source.mjs';

// 008 (FR-005, FR-005a, FR-005b, R8): dựng kho git tạm đủ năm dòng của bảng ở contracts/quality-gates.md mục 4.
// Ref `origin/master`, `origin/dev` được tạo bằng update-ref (không cần máy chủ từ xa).

interface Result {
  status: 'not_applicable' | 'ok' | 'failed';
  message: string;
}
const run = checkReleaseSource as (o: { env: Record<string, string>; cwd: string }) => Result;

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'release-source-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-q', '-b', 'master');
  const commit = (file: string, message: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), `${message}\n${Math.random()}`);
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const merge = (branch: string, message: string) => {
    git(
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      'merge',
      '--no-ff',
      '-q',
      '-m',
      message,
      branch,
    );
    return git('rev-parse', 'HEAD');
  };
  const setRemote = (name: 'master' | 'dev', sha: string) => {
    git('update-ref', `refs/remotes/origin/${name}`, sha);
  };
  return { root, git, commit, merge, setRemote };
}

/** master có 1 commit; dev tách ra với 2 commit; chưa có sửa nóng nào. */
function baseline() {
  const r = repo();
  const base = r.commit('app/base.txt', 'base');
  r.git('checkout', '-q', '-b', 'dev');
  const d1 = r.commit('app/d1.txt', 'dev 1');
  const d2 = r.commit('app/d2.txt', 'dev 2');
  r.setRemote('dev', d2);
  r.setRemote('master', base);
  return { ...r, base, d1, d2 };
}

const toMaster = (source: string, extra: Record<string, string> = {}) => ({
  GATE_TARGET_BRANCH: 'master',
  GATE_SOURCE_BRANCH: source,
  ...extra,
});

describe('tooling/check-release-source.mjs', () => {
  it('đích không phải master → không áp dụng', () => {
    const r = baseline();
    for (const target of ['dev', '']) {
      expect(
        run({ env: { GATE_TARGET_BRANCH: target, GATE_SOURCE_BRANCH: 'impl/x' }, cwd: r.root }),
      ).toEqual({
        status: 'not_applicable',
        message: 'đích không phải master',
      });
    }
  });

  it('dev → master: đầu PR đã triển khai thành công lên test, không có sửa nóng thiếu → đạt', () => {
    const r = baseline();
    expect(run({ env: toMaster('dev', { STAGING_DEPLOYED_SHA: r.d2 }), cwd: r.root }).status).toBe(
      'ok',
    );
  });

  it('dev → master: test mới triển khai tới commit cũ hơn đầu PR → không đạt, nêu commit', () => {
    const r = baseline();
    const result = run({ env: toMaster('dev', { STAGING_DEPLOYED_SHA: r.d1 }), cwd: r.root });
    expect(result.status).toBe('failed');
    expect(result.message).toContain(
      `Commit ${r.d2.slice(0, 12)} chưa được triển khai thành công lên test`,
    );
    expect(result.message).toContain('Chờ test xanh');
  });

  it('dev → master: thiếu STAGING_DEPLOYED_SHA → không đạt với thông điệp rõ', () => {
    const r = baseline();
    const result = run({ env: toMaster('dev'), cwd: r.root });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('STAGING_DEPLOYED_SHA');
  });

  it('dev → master: có bản sửa nóng trên master mà dev chưa có → không đạt, nêu commit sửa nóng', () => {
    const r = baseline();
    r.git('checkout', '-q', 'master');
    const fix = r.commit('app/fix.txt', 'hotfix trên master');
    r.setRemote('master', fix);
    r.git('checkout', '-q', 'dev');
    const result = run({ env: toMaster('dev', { STAGING_DEPLOYED_SHA: r.d2 }), cwd: r.root });
    expect(result.status).toBe('failed');
    expect(result.message).toContain(`Bản sửa nóng ${fix.slice(0, 12)} chưa về dev`);
    expect(result.message).toContain('backmerge');
  });

  it('dev → master: sau một merge commit phát hành thường master KHÔNG bị coi là có sửa nóng thiếu', () => {
    const r = baseline();
    r.git('checkout', '-q', 'master');
    const release = r.merge('dev', 'phát hành 1');
    r.setRemote('master', release);
    r.git('checkout', '-q', 'dev');
    const d3 = r.commit('app/d3.txt', 'dev 3');
    r.setRemote('dev', d3);
    expect(run({ env: toMaster('dev', { STAGING_DEPLOYED_SHA: d3 }), cwd: r.root }).status).toBe(
      'ok',
    );
  });

  it('dev → master: sửa nóng đã backmerge về dev → đạt', () => {
    const r = baseline();
    r.git('checkout', '-q', 'master');
    const fix = r.commit('app/fix.txt', 'hotfix trên master');
    r.setRemote('master', fix);
    r.git('checkout', '-q', 'dev');
    const back = r.merge('master', 'backmerge');
    r.setRemote('dev', back);
    expect(run({ env: toMaster('dev', { STAGING_DEPLOYED_SHA: back }), cwd: r.root }).status).toBe(
      'ok',
    );
  });

  it('hotfix/* tách từ master, chỉ mang commit riêng → đạt', () => {
    const r = baseline();
    r.git('checkout', '-q', '-b', 'hotfix/loi-dang-bai', r.base);
    r.commit('app/hotfix.txt', 'sửa lỗi');
    expect(run({ env: toMaster('hotfix/loi-dang-bai'), cwd: r.root }).status).toBe('ok');
  });

  it('hotfix/* mang commit của dev → không đạt, nêu commit', () => {
    const r = baseline();
    r.git('checkout', '-q', '-b', 'hotfix/sai', r.d2);
    r.commit('app/hotfix.txt', 'sửa lỗi');
    const result = run({ env: toMaster('hotfix/sai'), cwd: r.root });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Nhánh hotfix mang commit của dev');
    expect(result.message).toContain('Tách lại từ master');
  });

  it('hotfix/* kèm migration → không đạt (migration có mốc cũ bị bỏ qua âm thầm – research R11)', () => {
    const r = baseline();
    r.git('checkout', '-q', '-b', 'hotfix/co-migration', r.base);
    r.commit('apps/server/drizzle/migrations/0099_fix.sql', 'sửa + migration');
    const result = run({ env: toMaster('hotfix/co-migration'), cwd: r.root });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Sửa nóng không được kèm migration');
    expect(result.message).toContain('0099_fix.sql');
  });

  it('nguồn khác (nhánh tính năng) → không đạt', () => {
    const r = baseline();
    for (const source of ['impl/008-x', 'feature/abc', '']) {
      const result = run({ env: toMaster(source, { STAGING_DEPLOYED_SHA: r.d2 }), cwd: r.root });
      expect(result).toEqual({
        status: 'failed',
        message: 'master chỉ nhận từ dev hoặc hotfix/*.',
      });
    }
  });
});
