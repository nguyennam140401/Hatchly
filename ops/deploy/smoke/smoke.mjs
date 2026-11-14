// Kiểm tra khói sau triển khai (008 T073, FR-032, contracts/deploy-pipeline.md mục 5).
// Dùng: node ops/deploy/smoke/smoke.mjs --env staging --expect-version <sha>
// Biến môi trường: SMOKE_TOKEN (mã điểm cuối /ops/smoke), SMOKE_USER + SMOKE_PASSWORD (tài khoản kiểm tra nội bộ).
// Chỉ đi qua HTTPS công khai. In MỘT dòng kết quả mỗi mục (api.health, db+queue, login, web); mã thoát 0 khi đạt cả
// bốn. KHÔNG in giá trị bí mật, KHÔNG gọi nền tảng mạng xã hội / nhà cung cấp AI / gửi email.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const join = (base, path) => `${base.replace(/\/+$/, '')}${path}`;

async function getJson(fetchFn, url, init) {
  const res = await fetchFn(url, init);
  let body;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body, res };
}

/** Một mục kiểm tra: bắt mọi lỗi thành kết quả không đạt (không ném). */
async function check(name, fn) {
  try {
    const detail = await fn();
    return { name, ok: true, detail: detail ?? '' };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * @param {{apiBase: string, webBase: string, expect: string, token?: string, user?: string, password?: string,
 *          deadline: number, fetchFn?: typeof fetch, now?: () => number, wait?: (ms: number) => Promise<void>}} o
 * @returns {Promise<{name: string, ok: boolean, detail: string}[]>}
 */
export async function runSmoke(o) {
  const fetchFn = o.fetchFn ?? fetch;
  const now = o.now ?? Date.now;
  const wait = o.wait ?? sleep;
  const remaining = () => Math.max(0, o.deadline - now());
  const results = [];

  results.push(
    await check('api.health', async () => {
      for (const path of ['/healthz', '/readyz']) {
        const r = await getJson(fetchFn, join(o.apiBase, path));
        if (r.status !== 200) throw new Error(`${path} trả HTTP ${r.status}`);
        if (path === '/healthz' && r.body?.version !== o.expect) {
          throw new Error(
            `phiên bản API ${r.body?.version ?? '?'} ≠ mong đợi ${o.expect.slice(0, 12)}`,
          );
        }
      }
      return `version=${o.expect.slice(0, 12)}`;
    }),
  );

  results.push(
    await check('db+queue', async () => {
      if (!o.token) throw new Error('thiếu SMOKE_TOKEN');
      const headers = { 'x-smoke-token': o.token };
      const created = await getJson(fetchFn, join(o.apiBase, '/api/v1/ops/smoke'), {
        method: 'POST',
        headers,
      });
      if (created.status !== 202 || !created.body?.id)
        throw new Error(`POST /ops/smoke trả HTTP ${created.status}`);
      const id = created.body.id;
      while (remaining() > 0) {
        const r = await getJson(fetchFn, join(o.apiBase, `/api/v1/ops/smoke/${id}`), { headers });
        if (r.status !== 200) throw new Error(`GET /ops/smoke trả HTTP ${r.status}`);
        if (r.body.processedAt) {
          if (r.body.apiVersion !== o.expect || r.body.workerVersion !== o.expect) {
            throw new Error(
              `phiên bản api=${r.body.apiVersion} worker=${r.body.workerVersion} ≠ mong đợi ${o.expect.slice(0, 12)}`,
            );
          }
          return 'API ghi CSDL, Worker xử lý đúng phiên bản';
        }
        await wait(1000);
      }
      throw new Error('Worker không xử lý việc kiểm tra khói trong thời hạn');
    }),
  );

  results.push(
    await check('login', async () => {
      if (!o.user || !o.password) throw new Error('thiếu SMOKE_USER / SMOKE_PASSWORD');
      const origin = new URL(o.webBase).origin;
      const login = await fetchFn(join(o.apiBase, '/api/v1/auth/login'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ email: o.user, password: o.password }),
      });
      if (login.status !== 200) throw new Error(`đăng nhập trả HTTP ${login.status}`);
      const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
      if (cookie === '') throw new Error('đăng nhập không cấp phiên');
      const logout = await fetchFn(join(o.apiBase, '/api/v1/auth/logout'), {
        method: 'POST',
        headers: { origin, cookie },
      });
      if (logout.status !== 204) throw new Error(`đăng xuất trả HTTP ${logout.status}`);
      return 'đăng nhập và đăng xuất tài khoản kiểm tra nội bộ';
    }),
  );

  results.push(
    await check('web', async () => {
      if (!o.webBase.startsWith('https://')) throw new Error('web.baseUrl phải là HTTPS');
      const home = await fetchFn(join(o.webBase, '/'));
      if (home.status !== 200) throw new Error(`GET / trả HTTP ${home.status}`);
      const html = await home.text();
      const release = await fetchFn(join(o.webBase, `/releases/${o.expect}/index.html`));
      if (release.status !== 200)
        throw new Error(`thiếu releases/${o.expect.slice(0, 12)}/index.html`);
      if ((await release.text()) !== html)
        throw new Error('index.html đang chạy khác bản đã đưa lên');
      const script = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1];
      if (!script) throw new Error('index.html không có tệp JS chính');
      const js = await fetchFn(new URL(script, `${o.webBase.replace(/\/+$/, '')}/`).href);
      if (js.status !== 200) throw new Error(`tệp JS chính trả HTTP ${js.status}`);
      return 'index.html khớp bản phát hành, tải được JS chính';
    }),
  );
  return results;
}

async function main(argv, env) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const name = flag('--env');
  const expect = flag('--expect-version');
  if (!name || !expect) {
    console.error('✖ cần --env và --expect-version');
    return 2;
  }
  const { parse } = createRequire(`${root}tooling/package.json`)('yaml');
  const params = parse(readFileSync(flag('--file') ?? `ops/deploy/env/${name}.yaml`, 'utf8'));
  if (params.name !== name) {
    console.error(`✖ --env "${name}" không khớp name "${params.name}" trong tệp tham số`);
    return 2;
  }
  const results = await runSmoke({
    apiBase: params.api.baseUrl,
    webBase: params.web.baseUrl,
    expect,
    token: env.SMOKE_TOKEN,
    user: env.SMOKE_USER,
    password: env.SMOKE_PASSWORD,
    deadline: Date.now() + params.smoke.timeoutSeconds * 1000,
  });
  for (const r of results)
    console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.detail ? ` – ${r.detail}` : ''}`);
  return results.every((r) => r.ok) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
