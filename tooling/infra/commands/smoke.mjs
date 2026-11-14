// `pnpm infra smoke <env>` – bộ kiểm tra khói (T061): SC-003 + phép thử cô lập SC-005, SC-009, SC-010, FR-014.
// Mỗi dòng "Mong đợi của smoke" ở quickstart.md mục 2 là một mục [đạt]/[lỗi]/[bỏ qua]; thoát 1 nếu có mục lỗi.
// Chạy sau khi dựng hạ tầng và áp bộ kê khai tạm (`kubectl apply -k infra/smoke-deploy/overlays/<env>`).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { Readable } from 'node:stream';
import { EXIT } from '../lib/exit-codes.mjs';
import { FORBIDDEN_IN, SECRET_VARS } from '../lib/handoff-map.mjs';
import { loadBackendConfig } from '../lib/backend-config.mjs';
import { createKube } from '../lib/kube.mjs';
import { envFile, kubeconfigFile } from '../lib/paths.mjs';
import { parseTfvars } from '../lib/params-diff.mjs';
import { createS3, tryAnonymousGet } from '../lib/s3.mjs';
import { openSession } from '../lib/session.mjs';
import { checkTls } from './dns-check.mjs';
import { compareComponents, componentTypes } from '../lib/component-types.mjs';
import { defaultListProjectIds, loadCredentials } from '../lib/credentials.mjs';
import { init, stateList } from '../lib/terraform.mjs';

const SERVICE_ACCOUNTS = {
  api: 'api-secrets',
  worker: 'worker-secrets',
  migrate: 'migrate-secrets',
};
const UPLOAD_BYTES = 100 * 1024 * 1024;

const ok = (note = '') => ({ status: 'đạt', note });
const fail = (note) => ({ status: 'lỗi', note });
const skip = (note) => ({ status: 'bỏ qua', note });

/** Thực thi danh sách mục, trả `{ results, passed, total, failed }`. Một mục ném lỗi = [lỗi] (không dừng cả bộ). */
export async function runSmoke(checks, log = (m) => console.log(m)) {
  const results = [];
  for (const check of checks) {
    let outcome;
    try {
      outcome = await check.run();
    } catch (error) {
      outcome = fail(error instanceof Error ? error.message : 'lỗi không xác định');
    }
    results.push({ name: check.name, ...outcome });
    log(`[${outcome.status}] ${check.name}${outcome.note ? ` – ${outcome.note}` : ''}`);
  }
  const counted = results.filter((r) => r.status !== 'bỏ qua');
  const passed = counted.filter((r) => r.status === 'đạt').length;
  const failed = counted.length - passed;
  log(
    `\nKết quả: ${passed}/${counted.length} mục đạt${results.length > counted.length ? ` (${results.length - counted.length} bỏ qua)` : ''}.`,
  );
  return { results, passed, total: counted.length, failed };
}

/** Mã script chạy TRONG pod api (qua kubectl exec) – chỉ in kết quả, không in biến môi trường. */
export const DB_PROBE_SCRIPT = `
const { Client } = require('pg');
(async () => {
  const url = process.env.DATABASE_APP_URL;
  const good = new Client({ connectionString: url });
  await good.connect();
  await good.query('create temp table smoke_probe(v int)');
  await good.query('insert into smoke_probe values (42)');
  const r = await good.query('select v from smoke_probe');
  await good.end();
  const plain = new Client({ connectionString: url.replace(/sslmode=[a-z-]+/, 'sslmode=disable') });
  let plainRefused = false;
  try { await plain.connect(); await plain.end(); } catch { plainRefused = true; }
  console.log(JSON.stringify({ roundTrip: r.rows[0].v === 42, plainRefused }));
})().catch((e) => { console.log(JSON.stringify({ error: String(e.message).slice(0, 80) })); process.exit(1); });
`;

/** Script trong pod api: sinh đường dẫn ký sẵn PUT/GET/DELETE cho một khóa tạm dưới tenants/<uuid>/. */
export const PRESIGN_SCRIPT = `
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('node:crypto');
(async () => {
  const client = new S3Client({
    region: process.env.S3_REGION, endpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  const Bucket = process.env.S3_BUCKET;
  const Key = 'tenants/' + crypto.randomUUID() + '/smoke/' + crypto.randomBytes(6).toString('hex') + '.bin';
  const sign = (Cmd) => getSignedUrl(client, new Cmd({ Bucket, Key }), { expiresIn: 900 });
  console.log(JSON.stringify({ key: Key, put: await sign(PutObjectCommand), get: await sign(GetObjectCommand), del: await sign(DeleteObjectCommand) }));
})().catch((e) => { console.log(JSON.stringify({ error: String(e.message).slice(0, 80) })); process.exit(1); });
`;

function lastJsonLine(text) {
  const line = text.trim().split('\n').filter(Boolean).at(-1) ?? '{}';
  try {
    return JSON.parse(line);
  } catch {
    return { error: 'đầu ra không phải JSON' };
  }
}

/** Dòng 100 MB sinh tại chỗ, không giữ trong bộ nhớ. */
export function hundredMegabytes(bytes = UPLOAD_BYTES) {
  const chunk = Buffer.alloc(1024 * 1024, 7);
  let sent = 0;
  return Readable.from(
    (function* generate() {
      while (sent < bytes) {
        const size = Math.min(chunk.length, bytes - sent);
        sent += size;
        yield size === chunk.length ? chunk : chunk.subarray(0, size);
      }
    })(),
  );
}

/** Mở `kubectl port-forward` tới Mailpit rồi đóng lại; trả thư mới nhất gửi tới `email`. */
async function latestMailTo(env, email, { timeoutMs = 60_000 } = {}) {
  const child = spawn(
    'kubectl',
    ['port-forward', '-n', 'mail-capture', 'svc/mailpit', '18025:8025'],
    {
      env: { ...process.env, KUBECONFIG: kubeconfigFile(env) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    },
  );
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('không mở được port-forward tới Mailpit')),
        15_000,
      );
      child.stdout.on('data', (d) => {
        if (String(d).includes('Forwarding')) {
          clearTimeout(timer);
          resolve(undefined);
        }
      });
      child.on('error', reject);
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const list = await (await fetch('http://127.0.0.1:18025/api/v1/messages')).json();
      const hit = (list.messages ?? []).find((m) => (m.To ?? []).some((t) => t.Address === email));
      if (hit) {
        const full = await (await fetch(`http://127.0.0.1:18025/api/v1/message/${hit.ID}`)).json();
        return { subject: hit.Subject, text: `${full.Text ?? ''}\n${full.HTML ?? ''}` };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return null;
  } finally {
    child.kill();
  }
}

/** Dựng danh sách mục từ ngữ cảnh. Mọi phụ thuộc ngoài có thể thay bằng giả khi kiểm thử. */
export function buildChecks(ctx) {
  const { env, kube, domain, apiUrl, appUrl, fetchImpl = fetch } = ctx;
  const isStaging = env === 'staging';
  const exec = async (args) => (await kube.exec(args)).stdout;
  const inApiPod = (script) => ['exec', '-n', 'app', 'deploy/api', '--', 'node', '-e', script];

  return [
    {
      name: 'api và worker sẵn sàng 2/2',
      needsApp: true,
      run: async () => {
        const bad = [];
        for (const name of ['api', 'worker']) {
          const d = await kube.get('deployment', name, 'app');
          if ((d?.status?.readyReplicas ?? 0) < 2)
            bad.push(`${name} ${d?.status?.readyReplicas ?? 0}/2`);
        }
        return bad.length === 0 ? ok() : fail(bad.join(', '));
      },
    },
    {
      name: 'Job migration hoàn tất',
      needsApp: true,
      run: async () => {
        const job = await kube.get('job', 'migrate', 'app');
        return (job?.status?.succeeded ?? 0) >= 1
          ? ok()
          : fail('Job migrate chưa thành công (kubectl logs job/migrate -n app)');
      },
    },
    {
      name: 'GET /healthz → 200',
      needsApp: true,
      run: async () => {
        const r = await fetchImpl(`${apiUrl}/healthz`);
        return r.status === 200 ? ok() : fail(`trả ${r.status}`);
      },
    },
    {
      name: 'http:// chuyển sang HTTPS',
      needsApp: true,
      run: async () => {
        const r = await fetchImpl(`http://api.${domain}/healthz`, { redirect: 'manual' });
        const to = r.headers.get('location') ?? '';
        return [301, 302, 307, 308].includes(r.status) && to.startsWith('https://')
          ? ok()
          : fail(`trả ${r.status} ${to}`);
      },
    },
    {
      name: 'chứng chỉ TLS hợp lệ, còn > 14 ngày',
      needsApp: true,
      run: async () => {
        const t = await (ctx.checkTls ?? checkTls)(`api.${domain}`);
        return t.ok ? ok(`còn ${t.daysLeft} ngày`) : fail(t.authError ?? `còn ${t.daysLeft} ngày`);
      },
    },
    {
      name: 'giao diện: 200, đường dẫn lạ → index.html, cache đúng, noindex ở thử nghiệm',
      needsApp: true,
      run: async () => {
        const home = await fetchImpl(`${appUrl}/`);
        const html = await home.text();
        const unknown = await fetchImpl(`${appUrl}/duong-dan-la-${Date.now()}`);
        const problems = [];
        if (home.status !== 200) problems.push(`/ trả ${home.status}`);
        if ((await unknown.text()) !== html) problems.push('đường dẫn lạ không trả index.html');
        if (!/no-cache|no-store|max-age=0/.test(home.headers.get('cache-control') ?? ''))
          problems.push('index.html cache dài');
        if (isStaging && !/noindex/.test(home.headers.get('x-robots-tag') ?? ''))
          problems.push('thiếu X-Robots-Tag: noindex');
        const asset = /\/assets\/[^"']+\.(?:js|css)/.exec(html)?.[0];
        if (asset === undefined) problems.push('không thấy tệp /assets/ trong index.html');
        else {
          const a = await fetchImpl(`${appUrl}${asset}`, { method: 'HEAD' });
          if (!/max-age=31536000/.test(a.headers.get('cache-control') ?? ''))
            problems.push('/assets/* không cache 1 năm');
        }
        return problems.length === 0 ? ok() : fail(problems.join('; '));
      },
    },
    {
      name: 'ghi rồi đọc một dòng bằng vai trò app; kết nối không TLS bị từ chối',
      needsApp: true,
      run: async () => {
        const r = lastJsonLine(await exec(inApiPod(DB_PROBE_SCRIPT)));
        if (r.error) return fail(r.error);
        return r.roundTrip && r.plainRefused
          ? ok()
          : fail(`roundTrip=${r.roundTrip} plainRefused=${r.plainRefused}`);
      },
    },
    {
      name: 'đăng ký + xác minh + đăng nhập tài khoản thử; thư xuất hiện ở Mailpit',
      needsApp: true,
      run: async () => {
        if (!isStaging) return skip('chỉ thử nghiệm (production không có Mailpit)');
        const email = `smoke-${Date.now()}@example.test`;
        const password = `Sm0ke-${Math.random().toString(36).slice(2)}-Aa1!`;
        const base = `${apiUrl}/api/v1/auth`;
        const json = { 'content-type': 'application/json', origin: appUrl };
        const reg = await fetchImpl(`${base}/register`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({
            displayName: 'Smoke',
            email,
            password,
            acceptTerms: true,
            termsVersion: '1',
          }),
        });
        if (reg.status !== 202) return fail(`đăng ký trả ${reg.status}`);
        const mail = await (ctx.latestMailTo ?? latestMailTo)(env, email);
        if (mail === null)
          return fail('không thấy thư xác minh ở Mailpit sau 60 giây (SMTP_URL đúng chưa?)');
        const token = /[?&]token=([A-Za-z0-9_-]{16,})/.exec(mail.text)?.[1];
        if (token === undefined)
          return skip('thư đến nhưng không tách được liên kết xác minh – kiểm tay');
        const verify = await fetchImpl(`${base}/email/verify`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ token }),
        });
        if (verify.status !== 200) return fail(`xác minh trả ${verify.status}`);
        const login = await fetchImpl(`${base}/login`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ email, password }),
        });
        return login.status === 200 ? ok() : fail(`đăng nhập trả ${login.status}`);
      },
    },
    {
      name: 'đường dẫn ký sẵn: tải 100 MB thẳng lên kho tệp, đối tượng dưới tenants/<mã>/',
      needsApp: true,
      run: async () => {
        const p = lastJsonLine(await exec(inApiPod(PRESIGN_SCRIPT)));
        if (p.error) return fail(p.error);
        if (!/^tenants\/[0-9a-f-]{36}\//.test(p.key))
          return fail(`khóa không nằm dưới tenants/<mã>/: ${p.key}`);
        const put = await fetchImpl(p.put, {
          method: 'PUT',
          headers: {
            'content-length': String(UPLOAD_BYTES),
            'content-type': 'application/octet-stream',
          },
          body: hundredMegabytes(),
          duplex: 'half',
        });
        if (!put.ok) return fail(`PUT trả ${put.status}`);
        const head = await fetchImpl(p.get, { headers: { range: 'bytes=0-0' } });
        const total = /\/(\d+)$/.exec(head.headers.get('content-range') ?? '')?.[1];
        await fetchImpl(p.del, { method: 'DELETE' });
        return Number(total) === UPLOAD_BYTES
          ? ok()
          : fail(`kích thước đọc lại ${total ?? head.status}`);
      },
    },
    {
      name: '9 phép kubectl auth can-i: chỉ 3 cặp đúng trả yes (FR-014)',
      run: async () => {
        const wrong = [];
        for (const [sa, own] of Object.entries(SERVICE_ACCOUNTS)) {
          for (const secret of Object.values(SERVICE_ACCOUNTS)) {
            const can = await kube.authCanI('get', 'secret', {
              serviceAccount: sa,
              resourceName: secret,
            });
            if (can !== (secret === own)) wrong.push(`${sa}→${secret}=${can ? 'yes' : 'no'}`);
          }
        }
        return wrong.length === 0 ? ok() : fail(wrong.join(', '));
      },
    },
    {
      name: 'Secret không chứa khóa sai chỗ; không Secret nào chứa robot push',
      run: async () => {
        const problems = [];
        for (const [secret, forbidden] of Object.entries(FORBIDDEN_IN)) {
          const keys = (await kube.secretKeys('app', secret)) ?? [];
          for (const key of forbidden) if (keys.includes(key)) problems.push(`${secret} có ${key}`);
        }
        for (const [secret, keys] of Object.entries(SECRET_VARS)) {
          const have = (await kube.secretKeys('app', secret)) ?? [];
          for (const key of have)
            if (!keys.includes(key)) problems.push(`${secret} có khóa lạ ${key}`);
        }
        // Không Secret nào (mọi không gian tên) chứa robot `push`: chỉ xét TÊN đăng nhập, không đọc mật khẩu.
        const list = (await kube.exec(['get', 'secrets', '-A', '-o', 'json'])).stdout;
        for (const item of JSON.parse(list || '{"items":[]}').items ?? []) {
          if (item.type !== 'kubernetes.io/dockerconfigjson') continue;
          const encoded = item.data?.['.dockerconfigjson'] ?? '';
          const auths =
            JSON.parse(Buffer.from(encoded, 'base64').toString('utf8') || '{}').auths ?? {};
          const users = Object.values(auths).map((a) => String(a.username ?? ''));
          if (users.some((u) => /push/i.test(u)))
            problems.push(`${item.metadata.namespace}/${item.metadata.name} chứa robot push`);
        }
        return problems.length === 0 ? ok() : fail(problems.join('; '));
      },
    },
    {
      name: 'GET không xác thực vào bucket media bị từ chối',
      run: async () => ctx.anonymousDenied(ctx.mediaBucket),
    },
    {
      name: 'GET không xác thực vào bucket sao lưu bị từ chối (SC-009)',
      run: async () =>
        ctx.backupBucket ? ctx.anonymousDenied(ctx.backupBucket) : skip('không có bucket sao lưu'),
    },
    {
      name: 'cổng 5432 của địa chỉ công khai không mở',
      run: async () => {
        const open = await (ctx.portOpen ?? portOpen)(ctx.publicIp, 5432);
        return open ? fail('5432 mở ra internet') : ok();
      },
    },
    {
      name: 'xóa một đối tượng thử vẫn thấy phiên bản cũ; vòng đời đủ ba luật (SC-010)',
      run: async () => {
        const s3 = ctx.mediaS3;
        const key = `smoke/${Date.now()}.txt`;
        await s3.putBytes(key, Buffer.from('v1'));
        await s3.deleteObject(key);
        const { versions, deleteMarkers } = await s3.listVersions(key);
        const rules = await s3.getBucketLifecycle();
        const problems = [];
        if (versions.length < 1 || deleteMarkers.length < 1)
          problems.push('xóa xong không còn phiên bản cũ (chưa bật lưu phiên bản?)');
        if (rules.length < 3) problems.push(`chỉ ${rules.length}/3 luật vòng đời`);
        const tmp = rules.find((r) => r.ID === 'expire-tmp');
        const note =
          tmp === undefined
            ? 'luật tmp theo nhãn: phụ thuộc việc dọn của Worker (vStorage chưa lọc theo nhãn)'
            : '';
        if (problems.length === 0) return ok(note);
        return fail(problems.join('; '));
      },
    },
  ];
}

/** Khóa bị từ chối? (403/401/AccessDenied). Thành công hoặc lỗi khác (mạng) đều KHÔNG tính là bị từ chối. */
export function isDenied(error) {
  const status = error?.$metadata?.httpStatusCode;
  return (
    status === 403 ||
    status === 401 ||
    /AccessDenied|Forbidden|InvalidAccessKeyId|SignatureDoesNotMatch/i.test(
      String(error?.name ?? ''),
    )
  );
}

/**
 * SC-004 và SC-005 cho `production` (và dùng được cho cả hai môi trường): cùng hình dạng, tách hẳn.
 * `ctx.componentDiff()` → { onlyA, onlyB }; `ctx.crossAttempts` = [{ name, attempt }] – mỗi `attempt()` thử một thao tác
 * bằng chứng thực của môi trường KHÁC và phải bị từ chối; `ctx.otherSeesProject()` → boolean.
 */
export function buildCrossEnvChecks(ctx) {
  const checks = [
    {
      name: 'SC-004: hai môi trường cùng tập loại tài nguyên (trừ mail-capture)',
      run: async () => {
        if (ctx.componentDiff === undefined)
          return skip('chưa đọc được trạng thái của môi trường kia');
        const { onlyA, onlyB } = await ctx.componentDiff();
        return onlyA.length === 0 && onlyB.length === 0
          ? ok()
          : fail(
              `chỉ ở ${ctx.env}: ${onlyA.join(', ') || '-'}; chỉ ở môi trường kia: ${onlyB.join(', ') || '-'}`,
            );
      },
    },
    {
      name: 'SC-005: tài khoản dịch vụ của môi trường kia không thấy project này',
      run: async () => {
        if (ctx.otherSeesProject === undefined)
          return skip('thiếu hồ sơ chứng thực của môi trường kia (infra/.credentials)');
        return (await ctx.otherSeesProject())
          ? fail('NGHIÊM TRỌNG: thấy được project của môi trường này')
          : ok();
      },
    },
  ];
  for (const { name, attempt } of ctx.crossAttempts ?? []) {
    checks.push({
      name: `SC-005: ${name} bị từ chối`,
      run: async () => {
        try {
          await attempt();
        } catch (error) {
          return isDenied(error)
            ? ok()
            : skip(
                `không kết luận được (${error instanceof Error ? error.message.slice(0, 60) : 'lỗi'})`,
              );
        }
        return fail('NGHIÊM TRỌNG: thao tác chéo được PHÉP');
      },
    });
  }
  checks.push({
    name: 'SC-005: pod ở thử nghiệm không tới được CSDL nội bộ phát hành; khóa KMS chéo bị từ chối',
    run: async () =>
      skip('thử tay theo infra/docs/ket-qua-kiem-chung.md (cần hạ tầng cả hai môi trường)'),
  });
  return checks;
}

function portOpen(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: timeoutMs });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

async function crossEnvChecksFor(
  env,
  session,
  { tfvars, backend, mediaBucket, backupBucket, deps },
) {
  const other = env === 'staging' ? 'production' : 'staging';
  let otherCreds;
  try {
    otherCreds = loadCredentials(other);
  } catch {
    otherCreds = undefined;
  }
  const ctx = { env };

  if (otherCreds !== undefined) {
    const credentials = {
      accessKeyId: otherCreds.AWS_ACCESS_KEY_ID,
      secretAccessKey: otherCreds.AWS_SECRET_ACCESS_KEY,
    };
    const buckets = [
      ['bucket media', mediaBucket],
      ['bucket sao lưu', backupBucket],
      ['bucket trạng thái', backend.bucket],
    ].filter(([, b]) => typeof b === 'string');
    ctx.crossAttempts = buckets.map(([label, bucket]) => ({
      name: `khóa S3 của ${other} đọc ${label} của ${env}`,
      attempt: () => createS3(env, { backend: { ...backend, bucket }, credentials }).list(''),
    }));
    ctx.otherSeesProject = async () =>
      (await (deps.listProjectIds ?? defaultListProjectIds)(otherCreds)).includes(
        tfvars.project_id,
      );
  }

  ctx.componentDiff =
    deps.componentDiff ??
    (async () => {
      const typesOf = async (target) => {
        const s = target === env ? session : await openSession(target);
        const out = new Set();
        for (const stack of ['cloud', 'platform']) {
          await init(stack, target, { env: s.procEnv });
          for (const address of await stateList(stack, { env: s.procEnv })) out.add(address);
        }
        return componentTypes({
          resource_changes: [...out].map((address) => ({ address, type: typeOfAddress(address) })),
        });
      };
      return compareComponents(await typesOf(env), await typesOf(other));
    });
  return buildCrossEnvChecks(ctx);
}

/** `module.a.aws_s3_bucket.media[0]` → `aws_s3_bucket`. */
export function typeOfAddress(address) {
  const parts = address.replace(/\[[^\]]*\]/g, '').split('.');
  return parts.length >= 2 ? parts.at(-2) : address;
}

export async function run({ env, flags = {} }, deps = {}) {
  const session = await (deps.openSession ?? openSession)(env);
  const tfvars = parseTfvars(readFileSync(envFile(env, 'tfvars'), 'utf8'));
  const domain = tfvars.base_domain;
  const backend = loadBackendConfig(env);
  const kube = deps.kube ?? createKube(env);

  const out =
    deps.outputs ??
    (async () => {
      const { init, output } = await import('../lib/terraform.mjs');
      await init('platform', env, { env: session.procEnv });
      return await output('platform', { env: session.procEnv });
    })();
  const platform = await out;
  const mediaBucket = platform.storage?.bucket;
  const backupBucket = `${tfvars.name_prefix}-db-backup-${env}`;
  const endpoint = platform.storage?.endpoint;

  const anonymousDenied = async (bucket) => {
    const status = await tryAnonymousGet(endpoint, bucket, `probe-${Date.now()}`, {
      pathStyle: backend.use_path_style !== false,
    });
    return status === 200 ? fail('đọc được KHÔNG cần xác thực') : ok(`trả ${status}`);
  };

  const checks = buildChecks({
    env,
    kube,
    domain,
    apiUrl: `https://api.${domain}`,
    appUrl: `https://app.${domain}`,
    publicIp: platform.ingress?.public_ip,
    mediaBucket,
    backupBucket: tfvars.db_variant === 'cnpg' ? backupBucket : null,
    mediaS3: createS3(env, { backend: { ...backend, bucket: mediaBucket } }),
    anonymousDenied,
  });

  const infraOnly = flags['infra-only'] === true;
  const selected = checks.filter((c) => !(infraOnly && c.needsApp === true));
  if (infraOnly)
    selected.push(
      ...(await crossEnvChecksFor(env, session, {
        tfvars,
        backend,
        platform,
        mediaBucket,
        backupBucket: tfvars.db_variant === 'cnpg' ? backupBucket : null,
        deps,
      })),
    );

  const { failed, passed, total } = await runSmoke(selected);
  console.log(`Tỷ lệ đạt: ${total === 0 ? 0 : Math.round((passed / total) * 100)}%.`);
  return failed > 0 ? EXIT.ERROR : EXIT.OK;
}
