import { describe, expect, it } from 'vitest';
import { checkImage, checkVersion, containerDbUrl, evaluateContents } from '../check-image.mjs';

// 008 (FR-022…024): phần thuần logic của check:image – không dựng ảnh thật trong kiểm thử đơn vị.

interface Found {
  envFiles: string[];
  webPaths: string[];
  devPackages: string[];
  user: string;
  uid: string;
}
const evaluate = evaluateContents;
const version = checkVersion as (
  body: string,
  expected: string,
  label: string,
) => string | undefined;
const dbUrl = containerDbUrl;
interface Reply {
  status: number;
  stdout?: string;
  stderr?: string;
}
const check = checkImage as (o: {
  env: Record<string, string | undefined>;
  run: (command: string, args: string[]) => Reply;
  log: (s: string) => void;
  waitMs?: number;
}) => Promise<{ status: string; problems: string[]; note: string }>;

const CLEAN: Found = { envFiles: [], webPaths: [], devPackages: [], user: 'node', uid: '1000' };

describe('tooling/check-image.mjs – phân tích nội dung ảnh', () => {
  it('ảnh sạch → không vấn đề', () => {
    expect(evaluate(CLEAN)).toEqual([]);
  });

  it('mỗi loại vi phạm được nêu riêng', () => {
    expect(evaluate({ ...CLEAN, envFiles: ['/app/.env'] })[0]).toContain('/app/.env');
    expect(evaluate({ ...CLEAN, webPaths: ['/app/apps/web'] })[0]).toContain('web');
    expect(evaluate({ ...CLEAN, devPackages: ['/app/node_modules/vitest'] })[0]).toContain(
      'vitest',
    );
    expect(evaluate({ ...CLEAN, user: '', uid: '0' })[0]).toContain('root');
    expect(evaluate({ ...CLEAN, user: 'root', uid: '1000' })[0]).toContain('root');
  });

  it('nhiều vi phạm → báo đủ, không dừng ở cái đầu', () => {
    expect(
      evaluate({ envFiles: ['a'], webPaths: ['b'], devPackages: ['c'], user: 'node', uid: '0' }),
    ).toHaveLength(4);
  });
});

describe('tooling/check-image.mjs – version và địa chỉ CSDL', () => {
  it('version trùng SHA → không lỗi; khác / không phải JSON → nêu rõ', () => {
    const body = JSON.stringify({ status: 'ok', version: 'abc123' });
    expect(version(body, 'abc123', 'api')).toBeUndefined();
    expect(version(body, 'def456', 'api')).toContain('cần "def456"');
    expect(version('<html>', 'abc123', 'worker')).toContain('không phải JSON');
  });

  it('localhost của máy chủ đổi sang địa chỉ nhìn từ container; máy khác giữ nguyên', () => {
    expect(dbUrl('postgres://u:p@localhost:5432/postgres', 'host.docker.internal')).toBe(
      'postgres://u:p@host.docker.internal:5432/postgres',
    );
    expect(dbUrl('postgres://u:p@db.internal:5432/postgres', 'host.docker.internal')).toBe(
      'postgres://u:p@db.internal:5432/postgres',
    );
  });
});

describe('tooling/check-image.mjs – điều kiện chạy và dọn dẹp (trình chạy lệnh giả)', () => {
  const log = () => undefined;

  it('không có Docker → SKIPPED (verify --ci biến thành không đạt)', async () => {
    const r = await check({
      env: { TEST_DATABASE_ADMIN_URL: 'postgres://x@h/p' },
      run: () => ({ status: 1 }),
      log,
    });
    expect(r.status).toBe('skipped');
    expect(r.note).toContain('Docker');
  });

  it('thiếu TEST_DATABASE_ADMIN_URL → SKIPPED', async () => {
    const r = await check({ env: {}, run: () => ({ status: 0, stdout: '29' }), log });
    expect(r.status).toBe('skipped');
    expect(r.note).toContain('TEST_DATABASE_ADMIN_URL');
  });

  it('docker build lỗi → failed, nêu dòng cuối, vẫn xóa ảnh + CSDL tạm', async () => {
    const calls: string[] = [];
    const r = await check({
      env: {
        TEST_DATABASE_ADMIN_URL: 'postgres://postgres:p@localhost:5432/postgres',
        APP_VERSION: 'a'.repeat(40),
      },
      run: (command, args) => {
        const line = `${command} ${args.join(' ')}`;
        calls.push(line);
        if (line.startsWith('docker build'))
          return { status: 1, stderr: 'step 3\nERROR: pnpm install failed' };
        return { status: 0, stdout: '' };
      },
      log,
    });
    expect(r.status).toBe('failed');
    expect(r.problems[0]).toContain('pnpm install failed');
    expect(calls.some((c) => c.startsWith('docker rmi -f app-check-image:'))).toBe(true);
    expect(calls.some((c) => c.includes('DROP DATABASE IF EXISTS'))).toBe(true);
  });

  it('migrate lỗi → failed, không chạy api/worker, vẫn dọn', async () => {
    const calls: string[] = [];
    const r = await check({
      env: {
        TEST_DATABASE_ADMIN_URL: 'postgres://postgres:p@localhost:5432/postgres',
        APP_VERSION: 'b'.repeat(40),
      },
      run: (command, args) => {
        const line = `${command} ${args.join(' ')}`;
        calls.push(line);
        if (line.includes('dist/db/migrate.js'))
          return { status: 1, stderr: 'Lỗi: migration hỏng' };
        if (line.includes('-u')) return { status: 0, stdout: '1000' };
        if (line.includes('--format {{.Config.User}}')) return { status: 0, stdout: 'node' };
        return { status: 0, stdout: '' };
      },
      log,
    });
    expect(r.status).toBe('failed');
    expect(r.problems.join('\n')).toContain('vai migrate lỗi');
    expect(calls.some((c) => c.includes('dist/api.js'))).toBe(false);
    expect(calls.some((c) => c.startsWith('docker rmi -f'))).toBe(true);
  });
});
