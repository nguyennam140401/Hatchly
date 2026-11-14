// pnpm db:compat – kiểm tra ĐỘNG tương thích ngược (008, FR-018, R12): bản đang chạy ở môi trường đích phải
// chạy được trên cấu trúc CSDL của bản mới. Trả lời "API/Worker cũ + migration mới song song có an toàn
// không" bằng cách thật sự chạy bản cũ trên CSDL đã migrate bằng migration của HEAD.
//
// Các bước: (1) bản gốc = COMPAT_BASE_SHA, mặc định origin/<GATE_TARGET_BRANCH hoặc dev>; "none" → chưa có bản
// đang chạy; (2) không có migration mới so với bản gốc → không áp dụng; (3) bản gốc chưa có kịch bản
// test:compat → không áp dụng; (4) dựng bản gốc ở .compat-base/ (git worktree); (5) CSDL tạm, áp migration của
// HEAD; (6) chạy `pnpm test:compat` của bản gốc trên CSDL đó; (7) luôn dọn worktree và CSDL.
// Đầu ra dùng quy ước của verify: dòng `NOT_APPLICABLE: <lý do>` (thoát 0).
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIGRATIONS = 'apps/server/drizzle/migrations';
export const WORKTREE = '.compat-base';

/** Chạy lệnh, trả { status, stdout, stderr } (không ném lỗi). */
export function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32' && command === 'pnpm',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

const firstErrorLine = (text) => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return (
    lines.find((l) => /(error|✗|✖|FAIL|failed)/i.test(l)) ?? lines.at(-1) ?? '(không có đầu ra)'
  );
};

/**
 * @param {{ env?: Record<string,string|undefined>, run?: typeof defaultRun, root?: string, log?: (s: string) => void }} options
 * @returns {{ status: 'not_applicable'|'ok'|'failed', note: string }}
 */
export function dbCompat({
  env = process.env,
  run = defaultRun,
  root = process.cwd(),
  log = console.log,
} = {}) {
  const git = (...args) => run('git', args, { cwd: root });
  const baseRef =
    env.COMPAT_BASE_SHA?.trim() || `origin/${env.GATE_TARGET_BRANCH?.trim() || 'dev'}`;

  // (1) bản gốc
  if (baseRef === 'none') return { status: 'not_applicable', note: 'chưa có bản đang chạy' };
  const resolved = git('rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`);
  if (resolved.status !== 0) {
    return { status: 'not_applicable', note: `chưa có bản đang chạy (không thấy ${baseRef})` };
  }
  const baseSha = resolved.stdout.trim();

  // (2) migration mới
  const diff = git('diff', '--name-only', '--diff-filter=A', baseSha, 'HEAD', '--', MIGRATIONS);
  const added = diff.stdout
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.endsWith('.sql'));
  if (added.length === 0) return { status: 'not_applicable', note: 'không có migration mới' };

  // (3) bản gốc có hợp đồng test:compat không
  const pkg = git('show', `${baseSha}:apps/server/package.json`);
  let hasCompat = false;
  try {
    hasCompat = Boolean(JSON.parse(pkg.stdout).scripts?.['test:compat']);
  } catch {
    hasCompat = false;
  }
  if (!hasCompat) {
    return {
      status: 'not_applicable',
      note: `bản gốc ${baseSha.slice(0, 12)} chưa có kịch bản test:compat (bản trước 008)`,
    };
  }

  const worktree = resolve(root, WORKTREE);
  let database;
  try {
    // (4) dựng bản gốc
    log(
      `▸ bản gốc ${baseSha.slice(0, 12)} · migration mới: ${added.map((f) => f.split('/').pop()).join(', ')}`,
    );
    if (existsSync(worktree)) {
      git('worktree', 'remove', '--force', WORKTREE);
      rmSync(worktree, { recursive: true, force: true });
    }
    const added1 = git('worktree', 'add', '--detach', WORKTREE, baseSha);
    if (added1.status !== 0) {
      return {
        status: 'failed',
        note: `không tạo được worktree bản gốc: ${firstErrorLine(added1.stderr)}`,
      };
    }
    for (const [label, command, args] of [
      ['cài phụ thuộc bản gốc', 'pnpm', ['install', '--frozen-lockfile']],
      ['dựng gói shared của bản gốc', 'pnpm', ['build:shared']],
    ]) {
      const step = run(command, args, { cwd: worktree });
      if (step.status !== 0) {
        return {
          status: 'failed',
          note: `${label} lỗi: ${firstErrorLine(step.stderr + step.stdout)}`,
        };
      }
    }

    // (5) CSDL tạm với migration của HEAD
    const created = run(
      'pnpm',
      ['--filter', '@app/server', 'exec', 'tsx', 'src/db/prepare-compat-db.ts', 'create'],
      {
        cwd: root,
      },
    );
    if (created.status !== 0) {
      return {
        status: 'failed',
        note: `không dựng được CSDL tạm: ${firstErrorLine(created.stderr + created.stdout)}`,
      };
    }
    const jsonLine = created.stdout.split('\n').find((l) => l.startsWith('{'));
    database = JSON.parse(jsonLine ?? '{}');

    // (6) chạy test:compat của bản gốc
    const compat = run('pnpm', ['test:compat'], {
      cwd: worktree,
      env: {
        ...env,
        COMPAT_DATABASE_OWNER_URL: database.owner,
        COMPAT_DATABASE_APP_URL: database.app,
        COMPAT_DATABASE_SYSTEM_URL: database.system,
        COMPAT_DATABASE_SUPPORT_URL: database.support,
      },
    });
    if (compat.status !== 0) {
      return {
        status: 'failed',
        note:
          `bản gốc ${baseSha.slice(0, 12)} KHÔNG chạy được trên cấu trúc mới (migration: ` +
          `${added.map((f) => f.split('/').pop()).join(', ')}): ${firstErrorLine(compat.stdout + compat.stderr)}`,
      };
    }
    return { status: 'ok', note: `bản gốc ${baseSha.slice(0, 12)} chạy được trên cấu trúc mới` };
  } finally {
    // (7) luôn dọn
    if (database?.name) {
      run(
        'pnpm',
        [
          '--filter',
          '@app/server',
          'exec',
          'tsx',
          'src/db/prepare-compat-db.ts',
          'drop',
          database.name,
        ],
        {
          cwd: root,
        },
      );
    }
    // Gỡ vô điều kiện (worktree có thể đã tạo dở khi lỗi giữa chừng) rồi xóa thư mục còn sót.
    git('worktree', 'remove', '--force', WORKTREE);
    rmSync(worktree, { recursive: true, force: true });
    git('worktree', 'prune');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = dbCompat();
  if (result.status === 'not_applicable') console.log(`NOT_APPLICABLE: ${result.note}`);
  else if (result.status === 'ok') console.log(`✔ ${result.note}`);
  else {
    console.error(`✖ ${result.note}`);
    process.exit(1);
  }
}
