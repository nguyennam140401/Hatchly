// `pnpm infra secrets init|set|list|rotate` – quản lý Secret của Kubernetes (T054, T055; research R8, FR-014).
// Terraform KHÔNG giữ giá trị bí mật; CLI này tạo Secret trong cụm. Nguyên tắc cứng:
//  - không giá trị nào đi vào stdout/stderr, đối số dòng lệnh, nhật ký hay tệp;
//  - mỗi Secret chỉ nhận khóa hợp lệ của nó (FR-014) – vi phạm thì thoát 3;
//  - `init` chạy lại không đổi gì (chỉ tạo khóa còn thiếu).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CliExit, EXIT } from '../lib/exit-codes.mjs';
import { FORBIDDEN_IN, OTHER_SECRETS, SECRET_VARS } from '../lib/handoff-map.mjs';
import { createKube } from '../lib/kube.mjs';
import { envFile } from '../lib/paths.mjs';
import { parseTfvars } from '../lib/params-diff.mjs';
import { askHidden, ask } from '../lib/prompt.mjs';

const APP_NS = 'app';
const DB_NS = 'database';
const DB_HOST = 'pg-rw.database.svc';

/** Secret → không gian tên. */
export const NAMESPACE_OF = Object.freeze({
  'api-secrets': APP_NS,
  'worker-secrets': APP_NS,
  'migrate-secrets': APP_NS,
  'registry-pull': APP_NS,
  'pg-backup-s3': DB_NS,
});

const ROLES = Object.freeze({ OWNER: 'owner', APP: 'app', SYSTEM: 'system', SUPPORT: 'support' });

/** Khóa hợp lệ của từng Secret. */
export function allowedKeys(secret) {
  if (secret in SECRET_VARS) return SECRET_VARS[secret];
  if (secret in OTHER_SECRETS) return OTHER_SECRETS[secret].keys;
  return null;
}

/** FR-014: ném `CliExit(3)` nếu khóa không được phép nằm trong Secret này. */
export function assertKeyAllowed(secret, key) {
  const allowed = allowedKeys(secret);
  if (allowed === null)
    throw new CliExit(`Secret "${secret}" không có trong danh sách quản lý.`, EXIT.BLOCKED);
  if ((FORBIDDEN_IN[secret] ?? []).includes(key)) {
    throw new CliExit(
      `FR-014: khóa ${key} KHÔNG được nằm trong ${secret} (mỗi ServiceAccount chỉ đọc đúng Secret của mình).`,
      EXIT.BLOCKED,
    );
  }
  if (!allowed.includes(key)) {
    throw new CliExit(
      `Khóa ${key} không thuộc ${secret}. Khóa hợp lệ: ${allowed.join(', ')}.`,
      EXIT.BLOCKED,
    );
  }
}

export const newSecretValue = (rng = randomBytes) => rng(32).toString('base64url');

export function dbUrl(role, password, database = 'app') {
  return `postgres://${role}:${encodeURIComponent(password)}@${DB_HOST}:5432/${database}?sslmode=require`;
}

function makeContext(env, deps) {
  return {
    env,
    kube: deps.kube ?? createKube(env),
    rng: deps.rng ?? randomBytes,
    now: deps.now ?? (() => new Date()),
    log: deps.log ?? ((m) => console.log(m)),
  };
}

async function writeKey(ctx, secret, key, value, source, type) {
  assertKeyAllowed(secret, key);
  await ctx.kube.patchSecretKey(NAMESPACE_OF[secret], secret, key, value, {
    annotations: { 'infra/source': source, 'infra/rotated-at': ctx.now().toISOString() },
    ...(type !== undefined ? { type } : {}),
  });
}

// ------------------------------------------------------------------ init

/** Tạo các Secret tự sinh nếu chưa có. Trả số khóa đã tạo mới. */
export async function secretsInit(env, deps = {}) {
  const ctx = makeContext(env, deps);
  const { kube } = ctx;

  const existing = {};
  for (const name of ['api-secrets', 'worker-secrets', 'migrate-secrets']) {
    existing[name] = new Set((await kube.secretKeys(APP_NS, name)) ?? []);
  }
  const migrateValues = (await kube.secretValues(APP_NS, 'migrate-secrets')) ?? {};

  // Mật khẩu vai trò: dùng lại bản đã có (để dựng lại chuỗi kết nối thiếu), thiếu mới sinh.
  const passwords = {};
  for (const [suffix, role] of Object.entries(ROLES)) {
    passwords[role] = migrateValues[`DB_ROLE_PASSWORD_${suffix}`] ?? newSecretValue(ctx.rng);
  }
  const apiValues = (await kube.secretValues(APP_NS, 'api-secrets')) ?? {};
  const throttle = apiValues.AUTH_THROTTLE_SECRET ?? newSecretValue(ctx.rng);

  const superuser = await kube.secretValues(DB_NS, 'pg-superuser');
  const wanted = {
    'migrate-secrets': {
      DB_ROLE_PASSWORD_OWNER: passwords.owner,
      DB_ROLE_PASSWORD_APP: passwords.app,
      DB_ROLE_PASSWORD_SYSTEM: passwords.system,
      DB_ROLE_PASSWORD_SUPPORT: passwords.support,
      DATABASE_OWNER_URL: dbUrl('owner', passwords.owner),
      ...(superuser?.password
        ? {
            DATABASE_ADMIN_URL: dbUrl(
              superuser.username ?? 'postgres',
              superuser.password,
              'postgres',
            ),
          }
        : {}),
    },
    'api-secrets': {
      DATABASE_APP_URL: dbUrl('app', passwords.app),
      DATABASE_SUPPORT_URL: dbUrl('support', passwords.support),
      AUTH_THROTTLE_SECRET: throttle,
    },
    'worker-secrets': {
      DATABASE_APP_URL: dbUrl('app', passwords.app),
      DATABASE_SYSTEM_URL: dbUrl('system', passwords.system),
    },
  };

  let created = 0;
  for (const [secret, keys] of Object.entries(wanted)) {
    for (const [key, value] of Object.entries(keys)) {
      if (existing[secret].has(key)) continue;
      await writeKey(ctx, secret, key, value, 'generated');
      created += 1;
      ctx.log(`  + ${secret}/${key}`);
    }
  }
  if (superuser === null)
    ctx.log(
      '  ! pg-superuser chưa có (CSDL chưa lên): DATABASE_ADMIN_URL sẽ được tạo khi chạy lại sau khi CSDL sẵn sàng.',
    );
  ctx.log(created === 0 ? 'Mọi Secret tự sinh đã có – không đổi gì.' : `Đã tạo ${created} khóa.`);
  return created;
}

// ------------------------------------------------------------------ set

function registryServerOf(env) {
  const vars = parseTfvars(readFileSync(envFile(env, 'tfvars'), 'utf8'));
  return String(vars.registry?.server_image ?? '').split('/')[0];
}

/** Nhập một giá trị do bên ngoài cấp. Giá trị đọc từ bàn phím không hiện chữ, không qua đối số. */
export async function secretsSet(env, secret, key, deps = {}) {
  const ctx = makeContext(env, deps);
  assertKeyAllowed(secret, key);
  const hidden = deps.askHidden ?? askHidden;

  if (secret === 'registry-pull') {
    const username = await (deps.ask ?? ask)('Tên robot kéo ảnh (vd robot$pull-staging): ');
    const password = await hidden('Mật khẩu robot (không hiện chữ): ');
    const server = deps.registryServer ?? registryServerOf(env);
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    const config = JSON.stringify({ auths: { [server]: { username, password, auth } } });
    await writeKey(ctx, secret, key, config, 'external', 'kubernetes.io/dockerconfigjson');
  } else {
    const value = await hidden(`Giá trị cho ${secret}/${key} (không hiện chữ): `);
    if (value === '') throw new CliExit('Giá trị rỗng – không ghi.', EXIT.ERROR);
    await writeKey(ctx, secret, key, value, 'external');
  }
  ctx.log(`Đã ghi ${secret}/${key} (nguồn: external).`);
}

// ------------------------------------------------------------------ list

export async function secretsList(env, deps = {}) {
  const ctx = makeContext(env, deps);
  const rows = [];
  for (const secret of Object.keys(NAMESPACE_OF)) {
    const ns = NAMESPACE_OF[secret];
    const keys = await ctx.kube.secretKeys(ns, secret);
    const annotations = (await ctx.kube.secretAnnotations(ns, secret)) ?? {};
    rows.push({
      secret,
      namespace: ns,
      exists: keys !== null,
      keys: keys ?? [],
      source: annotations['infra/source'] ?? '-',
      rotatedAt: annotations['infra/rotated-at'] ?? '-',
    });
  }
  for (const r of rows) {
    ctx.log(
      `${r.secret} (${r.namespace}) ${r.exists ? `nguồn=${r.source} xoay=${r.rotatedAt}` : '[chưa có]'}`,
    );
    for (const k of r.keys) ctx.log(`   - ${k}`);
  }
  return rows;
}

// ------------------------------------------------------------------ rotate

const ROTATABLE = Object.freeze({
  'db-owner': { role: 'owner', suffix: 'OWNER', urls: [['migrate-secrets', 'DATABASE_OWNER_URL']] },
  'db-app': {
    role: 'app',
    suffix: 'APP',
    urls: [
      ['api-secrets', 'DATABASE_APP_URL'],
      ['worker-secrets', 'DATABASE_APP_URL'],
    ],
  },
  'db-system': {
    role: 'system',
    suffix: 'SYSTEM',
    urls: [['worker-secrets', 'DATABASE_SYSTEM_URL']],
  },
  'db-support': {
    role: 'support',
    suffix: 'SUPPORT',
    urls: [['api-secrets', 'DATABASE_SUPPORT_URL']],
  },
  'auth-throttle': { role: null, suffix: null, urls: [] },
});

export async function secretsRotate(env, name, deps = {}) {
  const ctx = makeContext(env, deps);
  const spec = ROTATABLE[name];
  if (spec === undefined) {
    throw new CliExit(
      `Tên xoay không hợp lệ: ${name}. Chọn: ${Object.keys(ROTATABLE).join(', ')}.`,
      EXIT.ERROR,
    );
  }
  const fresh = newSecretValue(ctx.rng);

  if (name === 'auth-throttle') {
    await writeKey(ctx, 'api-secrets', 'AUTH_THROTTLE_SECRET', fresh, 'generated');
    ctx.log('Bước 1/1 xong: AUTH_THROTTLE_SECRET đã đổi.');
  } else {
    // 1) đổi mật khẩu trong CSDL (qua stdin, không qua đối số) → 2) cập nhật Secret → ghi nhớ bước đã xong.
    const cluster = await ctx.kube.get('cluster.postgresql.cnpg.io', 'pg', DB_NS);
    const primary = cluster?.status?.currentPrimary;
    if (typeof primary !== 'string')
      throw new CliExit('Chưa xác định được bản chính của CSDL (Cluster pg).', EXIT.NOT_READY);
    const sql = `ALTER ROLE ${spec.role} WITH PASSWORD '${fresh}';\n`;
    const r = await ctx.kube.exec(
      [
        'exec',
        '-i',
        '-n',
        DB_NS,
        primary,
        '-c',
        'postgres',
        '--',
        'psql',
        '-U',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      sql,
    );
    if (r.code !== 0)
      throw new CliExit(
        'Đổi mật khẩu trong CSDL thất bại – chưa đổi Secret nào, chạy lại được.',
        EXIT.ERROR,
      );
    ctx.log('Bước 1: đã đổi mật khẩu trong CSDL.');
    await writeKey(ctx, 'migrate-secrets', `DB_ROLE_PASSWORD_${spec.suffix}`, fresh, 'generated');
    for (const [secret, key] of spec.urls)
      await writeKey(ctx, secret, key, dbUrl(spec.role, fresh), 'generated');
    ctx.log('Bước 2: đã cập nhật các Secret chứa mật khẩu/chuỗi kết nối.');
  }
  ctx.log(
    `Việc còn lại: khởi động lại ứng dụng – kubectl rollout restart deploy/api deploy/worker -n ${APP_NS}`,
  );
}

// ------------------------------------------------------------------ điểm vào

export async function run({ env, args }, deps = {}) {
  const [sub, ...rest] = args;
  // Cú pháp `secrets <lệnh con> <env> …`: môi trường là tham số thứ nhất sau lệnh con.
  const target = rest[0] ?? env;
  if (!['staging', 'production'].includes(target ?? '')) {
    throw new CliExit('Cú pháp: pnpm infra secrets init|set|list|rotate <env> …', EXIT.ERROR);
  }
  const tail = rest.slice(1);
  switch (sub) {
    case 'init':
      await secretsInit(target, deps);
      return EXIT.OK;
    case 'list':
      await secretsList(target, deps);
      return EXIT.OK;
    case 'set': {
      const [secret, key] = tail;
      if (secret === undefined || key === undefined)
        throw new CliExit('Cú pháp: pnpm infra secrets set <env> <secret> <khóa>', EXIT.ERROR);
      await secretsSet(target, secret, key, deps);
      return EXIT.OK;
    }
    case 'rotate':
      if (tail[0] === undefined)
        throw new CliExit('Cú pháp: pnpm infra secrets rotate <env> <tên>', EXIT.ERROR);
      await secretsRotate(target, tail[0], deps);
      return EXIT.OK;
    default:
      throw new CliExit('Lệnh con: init | set | list | rotate', EXIT.ERROR);
  }
}
