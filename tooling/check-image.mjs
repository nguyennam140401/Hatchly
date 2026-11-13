// pnpm check:image – ảnh phát hành đúng thứ cần có, chạy được ở cả ba vai (008, FR-022…024, R13).
// Dựng ảnh từ Dockerfile với APP_VERSION = SHA của HEAD, rồi:
//   1. kiểm nội dung: không `.env*`, không mã / bản dựng web, không devDependencies, người dùng chạy không phải root;
//   2. tạo CSDL tạm bằng TEST_DATABASE_ADMIN_URL và chạy CÙNG MỘT ảnh theo thứ tự `migrate` → `api` → `worker`,
//      chờ /healthz, /readyz của api và cổng sức khỏe 3001 của worker trả `version` = SHA.
// Luôn dọn container và CSDL tạm. Thiếu Docker hoặc CSDL → `SKIPPED:` (máy cá nhân); `pnpm verify --ci` biến
// thành không đạt. Biến: TEST_DATABASE_ADMIN_URL (bắt buộc), CHECK_IMAGE_DB_HOST (địa chỉ CSDL nhìn từ trong
// container, mặc định host.docker.internal), APP_VERSION (mặc định SHA của HEAD).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** Chạy lệnh, trả { status, stdout, stderr } (không ném lỗi). */
export function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const lines = (text) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');

/**
 * Phân tích kết quả kiểm nội dung ảnh (thuần logic – kiểm thử không cần dựng ảnh thật).
 * @param {{ envFiles: string[], webPaths: string[], devPackages: string[], user: string, uid: string }} found
 * @returns {string[]} danh sách vấn đề; rỗng = đạt
 */
export function evaluateContents(found) {
  const problems = [];
  if (found.envFiles.length > 0) {
    problems.push(`ảnh chứa tệp môi trường: ${found.envFiles.join(', ')}`);
  }
  if (found.webPaths.length > 0) {
    problems.push(`ảnh chứa mã / bản dựng web: ${found.webPaths.join(', ')}`);
  }
  if (found.devPackages.length > 0) {
    problems.push(`ảnh chứa devDependencies: ${found.devPackages.join(', ')}`);
  }
  if (found.uid === '0' || found.user === '' || found.user === 'root' || found.user === '0') {
    problems.push(
      `ảnh chạy bằng root (USER="${found.user || '(trống)'}", uid=${found.uid || '?'})`,
    );
  }
  return problems;
}

/** `version` trong thân JSON của điểm sức khỏe có đúng bản vừa dựng không. */
export function checkVersion(body, expected, label) {
  let version;
  try {
    version = JSON.parse(body).version;
  } catch {
    return `${label}: phản hồi không phải JSON`;
  }
  return version === expected
    ? undefined
    : `${label}: version="${String(version)}", cần "${expected}"`;
}

/** Địa chỉ CSDL nhìn từ trong container (localhost của máy chủ → host.docker.internal). */
export function containerDbUrl(url, host) {
  const u = new URL(url);
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname)) u.hostname = host;
  return u.toString();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitJson(url, accept, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = '(chưa kết nối)';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      const body = await res.text();
      last = `HTTP ${res.status}`;
      if (accept(res.status)) return { ok: true, body };
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(500);
  }
  return { ok: false, body: last };
}

/**
 * @param {{ env?: Record<string,string|undefined>, run?: typeof defaultRun, log?: (s:string)=>void, fetchWaitMs?: number }} options
 * @returns {Promise<{ status: 'ok'|'failed'|'skipped', problems: string[], note: string }>}
 */
export async function checkImage({
  env = process.env,
  run = defaultRun,
  log = console.log,
  waitMs = 60_000,
} = {}) {
  if (run('docker', ['info', '--format', '{{.ServerVersion}}']).status !== 0) {
    return {
      status: 'skipped',
      problems: [],
      note: 'không có Docker (daemon chưa chạy hoặc chưa cài)',
    };
  }
  const adminUrl = env.TEST_DATABASE_ADMIN_URL;
  if (!adminUrl)
    return { status: 'skipped', problems: [], note: 'chưa đặt TEST_DATABASE_ADMIN_URL' };

  const head = run('git', ['rev-parse', 'HEAD']);
  const sha = env.APP_VERSION?.trim() || head.stdout.trim();
  if (sha === '')
    return {
      status: 'failed',
      problems: ['không xác định được commit (git rev-parse HEAD)'],
      note: '',
    };

  const suffix = randomBytes(3).toString('hex');
  const image = `app-check-image:${sha.slice(0, 12)}-${suffix}`;
  const dbName = `app_image_${suffix}`;
  const dbHost = env.CHECK_IMAGE_DB_HOST || 'host.docker.internal';
  const containers = [];
  const problems = [];
  const docker = (...args) => run('docker', args);
  const hostFlags = ['--add-host=host.docker.internal:host-gateway'];

  // Vai trò CSDL là đối tượng cấp cụm, dùng chung với test:db → mật khẩu theo cùng quy ước (biến môi trường,
  // mặc định giá trị dev của kho; cụm CI mới tạo thì các giá trị này được dùng luôn).
  const roleEnv = {
    DB_ROLE_PASSWORD_OWNER: env.DB_ROLE_PASSWORD_OWNER ?? 'owner_dev_only',
    DB_ROLE_PASSWORD_APP: env.DB_ROLE_PASSWORD_APP ?? 'app_dev_only',
    DB_ROLE_PASSWORD_SYSTEM: env.DB_ROLE_PASSWORD_SYSTEM ?? 'system_dev_only',
    DB_ROLE_PASSWORD_SUPPORT: env.DB_ROLE_PASSWORD_SUPPORT ?? 'support_dev_only',
  };
  const url = (user, password) => {
    const u = new URL(containerDbUrl(adminUrl, dbHost));
    u.username = user;
    u.password = password;
    u.pathname = `/${dbName}`;
    return u.toString();
  };
  const admin = containerDbUrl(adminUrl, dbHost);
  const toArgs = (vars) => Object.entries(vars).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const appEnv = {
    APP_ENV: 'development',
    APP_VERSION: sha,
    LOG_LEVEL: 'warn',
    DATABASE_APP_URL: url('app', roleEnv.DB_ROLE_PASSWORD_APP),
    DATABASE_SYSTEM_URL: url('system', roleEnv.DB_ROLE_PASSWORD_SYSTEM),
    DATABASE_SUPPORT_URL: url('support', roleEnv.DB_ROLE_PASSWORD_SUPPORT),
    WEB_BASE_URL: 'http://image-check.test',
    WEB_ORIGINS: 'http://image-check.test',
    AUTH_THROTTLE_SECRET: 'image_check_only_throttle_secret_0123456789',
    TERMS_VERSION: '2026-11',
    MAIL_TRANSPORT: 'memory',
    STORAGE_DRIVER: 'memory',
    PLATFORM_GATEWAY_DRIVER: 'fake',
    AI_GATEWAY_DRIVER: 'fake',
    NOTIFICATIONS_DRIVER: 'fake',
    FAKE_STATE_STORE: 'sandbox',
  };

  try {
    // ---- dựng ảnh ----
    log(`▸ dựng ảnh ${image} (APP_VERSION=${sha.slice(0, 12)})`);
    const built = docker(
      'build',
      '-t',
      image,
      '--build-arg',
      `APP_VERSION=${sha}`,
      '--build-arg',
      `IMAGE_CREATED=${new Date().toISOString()}`,
      '--build-arg',
      'IMAGE_SOURCE=check-image',
      '-f',
      'Dockerfile',
      '.',
    );
    if (built.status !== 0) {
      const last = lines(built.stderr + built.stdout)
        .slice(-3)
        .join(' | ');
      return { status: 'failed', problems: [`docker build lỗi: ${last}`], note: '' };
    }

    // ---- 1. nội dung ảnh ----
    const inImage = (script) => docker('run', '--rm', '--entrypoint', 'sh', image, '-c', script);
    const found = {
      envFiles: lines(
        inImage("find / -xdev -name '.env*' -not -path '/proc/*' 2>/dev/null").stdout,
      ),
      webPaths: lines(
        inImage(
          "find /app -maxdepth 3 \\( -path '*/apps/web*' -o -name 'web' -o -name 'index.html' \\) -not -path '*/node_modules/*' 2>/dev/null",
        ).stdout,
      ),
      devPackages: lines(
        inImage(
          "find /app/node_modules -maxdepth 3 \\( -name 'vitest' -o -name 'typescript' -o -name 'tsx' -o -name 'drizzle-kit' \\) -not -path '*/@types/*' 2>/dev/null | head -5",
        ).stdout,
      ),
      user: docker('image', 'inspect', '--format', '{{.Config.User}}', image).stdout.trim(),
      uid: docker('run', '--rm', '--entrypoint', 'id', image, '-u').stdout.trim(),
    };
    problems.push(...evaluateContents(found));

    // ---- 2. ba vai trên CSDL tạm ----
    log(`▸ CSDL tạm ${dbName}: bootstrap vai trò + migrate (vai migrate)`);
    const boot = docker(
      'run',
      '--rm',
      ...hostFlags,
      ...toArgs({
        ...roleEnv,
        DATABASE_ADMIN_URL: admin,
        DATABASE_NAME: dbName,
        APP_ENV: 'development',
      }),
      image,
      'node',
      'dist/db/bootstrap.js',
      '--keep-existing-passwords',
    );
    if (boot.status !== 0) {
      problems.push(
        `vai migrate – bootstrap lỗi: ${lines(boot.stderr + boot.stdout)
          .slice(-2)
          .join(' | ')}`,
      );
    } else {
      const migrated = docker(
        'run',
        '--rm',
        ...hostFlags,
        ...toArgs({
          APP_ENV: 'development',
          DATABASE_OWNER_URL: url('owner', roleEnv.DB_ROLE_PASSWORD_OWNER),
        }),
        image,
        'node',
        'dist/db/migrate.js',
      );
      if (migrated.status !== 0) {
        problems.push(
          `vai migrate lỗi: ${lines(migrated.stderr + migrated.stdout)
            .slice(-2)
            .join(' | ')}`,
        );
      } else {
        const start = (name, extra, command) => {
          const started = docker(
            'run',
            '-d',
            '--rm',
            '--name',
            `${image.replace(/[:]/g, '-')}-${name}`,
            ...hostFlags,
            '-p',
            `127.0.0.1::${extra.port}`,
            ...toArgs({ ...appEnv, ...extra.env }),
            image,
            ...command,
          );
          if (started.status !== 0) return { error: lines(started.stderr).slice(-2).join(' | ') };
          const id = started.stdout.trim();
          containers.push(id);
          const mapped =
            docker('port', id, String(extra.port)).stdout.trim().split(/\r?\n/)[0] ?? '';
          const port = mapped.split(':').at(-1);
          return { id, base: `http://127.0.0.1:${port}` };
        };
        log('▸ chạy vai api rồi worker');
        const api = start('api', { port: 3000, env: { API_PORT: '3000' } }, [
          'node',
          'dist/api.js',
        ]);
        const worker = start(
          'worker',
          { port: 3001, env: { WORKER_HEALTH_PORT: '3001', API_PORT: '3002' } },
          ['node', 'dist/worker.js'],
        );
        for (const [label, unit] of [
          ['api', api],
          ['worker', worker],
        ]) {
          if (unit.error) {
            problems.push(`vai ${label} không khởi động được: ${unit.error}`);
            continue;
          }
          const health = await waitJson(`${unit.base}/healthz`, (s) => s === 200, waitMs);
          if (!health.ok) {
            const logs = lines(
              docker('logs', '--tail', '5', unit.id).stdout +
                docker('logs', '--tail', '5', unit.id).stderr,
            )
              .slice(-2)
              .join(' | ');
            problems.push(
              `vai ${label}: /healthz không đạt (${health.body})${logs ? ` – ${logs}` : ''}`,
            );
            continue;
          }
          const mismatch = checkVersion(health.body, sha, `vai ${label} /healthz`);
          if (mismatch) problems.push(mismatch);
          const ready = await waitJson(`${unit.base}/readyz`, (s) => s === 200, waitMs);
          if (!ready.ok) problems.push(`vai ${label}: /readyz không đạt (${ready.body})`);
        }
      }
    }
  } finally {
    for (const id of containers) docker('rm', '-f', id);
    docker('rmi', '-f', image);
    run('docker', [
      'run',
      '--rm',
      ...hostFlags,
      '-e',
      `PGCONNECT_TIMEOUT=5`,
      'postgres:17-alpine',
      'psql',
      admin,
      '-c',
      `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
    ]);
  }
  return problems.length > 0
    ? { status: 'failed', problems, note: '' }
    : {
        status: 'ok',
        problems: [],
        note: `ảnh ${sha.slice(0, 12)} đạt: nội dung + ba vai migrate/api/worker`,
      };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkImage();
  if (result.status === 'skipped') console.log(`SKIPPED: ${result.note}`);
  else if (result.status === 'ok') console.log(`✔ ${result.note}`);
  else {
    for (const p of result.problems) console.error(`✖ ${p}`);
    console.error(`✖ check:image không đạt (${result.problems.length} vấn đề)`);
    process.exit(1);
  }
}
