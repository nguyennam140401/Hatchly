// Đưa giao diện web lên kho tệp tĩnh theo bố cục của contracts/deploy-pipeline.md mục 4 (008 T072, FR-031, R16).
//   index.html                      con trỏ tới bản hiện hành – Cache-Control: no-cache
//   assets/<tên>.<băm>.<đuôi>       dùng chung giữa các bản – immutable, 1 năm; KHÔNG xóa tệp cũ khi đưa bản mới lên
//   releases/<sha>/index.html       bản sao để quay về
//   releases/<sha>/manifest.json    danh sách assets của bản này + thời điểm tải lên / kích hoạt
// Dùng:
//   node publish-web.mjs --env <env> --sha <sha>                 dựng @app/web + tải assets + releases/<sha>/ (CHƯA kích hoạt)
//   node publish-web.mjs --env <env> --sha <sha> --activate      ghi index.html CUỐI CÙNG (không dựng lại)
//   node publish-web.mjs --env <env> --rollback-to <sha>         chép releases/<sha>/index.html thành index.html
//   node publish-web.mjs --env <env> --prune                     xóa assets không thuộc bản hiện hành / bản kích hoạt ≤ 7 ngày
// Khóa S3 qua biến AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (thông tin `static-site` của thư mục môi trường).
// Mọi thao tác chạy lại được: tải tệp là ghi đè cùng nội dung.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';
const KEEP_DAYS = 7;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};
const contentType = (key) => TYPES[extname(key)] ?? 'application/octet-stream';

/** Duyệt thư mục → danh sách đường dẫn tương đối (dấu /). */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/**
 * Bộ chuyển đổi S3 mỏng – kiểm thử thay bằng bản trong bộ nhớ.
 * @typedef {{put(key: string, body: Buffer|string, o: {cacheControl: string}): Promise<void>,
 *            get(key: string): Promise<string|undefined>, list(prefix: string): Promise<string[]>,
 *            remove(keys: string[]): Promise<void>}} Store
 */

/** @returns {Promise<Store>} */
export async function awsStore({ bucket, endpoint, region }) {
  const sdk = createRequire(`${root}apps/server/package.json`)('@aws-sdk/client-s3');
  const client = new sdk.S3Client({ region, endpoint, forcePathStyle: true });
  return {
    async put(key, body, { cacheControl }) {
      await client.send(
        new sdk.PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          CacheControl: cacheControl,
          ContentType: contentType(key),
        }),
      );
    },
    async get(key) {
      try {
        const out = await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }));
        return await out.Body.transformToString();
      } catch (err) {
        if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return undefined;
        throw err;
      }
    },
    async list(prefix) {
      const keys = [];
      let token;
      do {
        const out = await client.send(
          new sdk.ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        );
        for (const o of out.Contents ?? []) keys.push(o.Key);
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
    async remove(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        await client.send(
          new sdk.DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
          }),
        );
      }
    },
  };
}

/** Tải assets (có băm, immutable) rồi releases/<sha>/; CHƯA đụng tới index.html. */
export async function publish({ store, distDir, sha, now = new Date() }) {
  const files = walk(distDir).map((f) => ({
    key: relative(distDir, f).replaceAll('\\', '/'),
    path: f,
  }));
  const assets = files.filter((f) => f.key.startsWith('assets/'));
  for (const f of assets) await store.put(f.key, readFileSync(f.path), { cacheControl: IMMUTABLE });
  const manifest = {
    sha,
    assets: assets.map((f) => f.key).sort(),
    uploadedAt: now.toISOString(),
    activatedAt: null,
  };
  const index = readFileSync(join(distDir, 'index.html'));
  await store.put(`releases/${sha}/manifest.json`, JSON.stringify(manifest), {
    cacheControl: NO_CACHE,
  });
  await store.put(`releases/${sha}/index.html`, index, { cacheControl: NO_CACHE });
  return manifest;
}

async function readManifest(store, sha) {
  const raw = await store.get(`releases/${sha}/manifest.json`);
  if (raw === undefined)
    throw new Error(`Không có releases/${sha}/manifest.json – chưa tải bản này lên`);
  return JSON.parse(raw);
}

/** Ghi index.html (CUỐI CÙNG) từ bản sao của `sha` và đánh dấu thời điểm kích hoạt. */
export async function activate({ store, sha, now = new Date() }) {
  const manifest = await readManifest(store, sha);
  const index = await store.get(`releases/${sha}/index.html`);
  if (index === undefined) throw new Error(`Không có releases/${sha}/index.html`);
  // Bản kích hoạt phải còn đủ assets (có thể đã bị dọn nếu quá cũ).
  const present = new Set(await store.list('assets/'));
  const missing = manifest.assets.filter((k) => !present.has(k));
  if (missing.length > 0)
    throw new Error(
      `Bản ${sha.slice(0, 12)} thiếu ${missing.length} tệp assets (đã bị dọn?) – dựng và tải lại`,
    );
  await store.put(
    `releases/${sha}/manifest.json`,
    JSON.stringify({ ...manifest, activatedAt: now.toISOString() }),
    { cacheControl: NO_CACHE },
  );
  await store.put('index.html', index, { cacheControl: NO_CACHE });
}

/** Quay về bản `sha`: chép index.html của bản đó thành index.html hiện hành. */
export const rollback = activate;

/** Xóa assets không thuộc manifest của bản hiện hành và các bản kích hoạt trong 7 ngày gần nhất. */
export async function prune({ store, now = new Date() }) {
  const shas = [...new Set((await store.list('releases/')).map((k) => k.split('/')[1]))];
  const manifests = [];
  for (const sha of shas) {
    const raw = await store.get(`releases/${sha}/manifest.json`);
    if (raw !== undefined) manifests.push(JSON.parse(raw));
  }
  const activated = manifests
    .filter((m) => m.activatedAt)
    .sort((a, b) => b.activatedAt.localeCompare(a.activatedAt));
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  const keepManifests = activated.filter((m, i) => i === 0 || Date.parse(m.activatedAt) >= cutoff);
  if (keepManifests.length === 0) return { deleted: [], kept: 0 }; // chưa kích hoạt bản nào → không xóa gì
  const keep = new Set(keepManifests.flatMap((m) => m.assets));
  const all = await store.list('assets/');
  const doomed = all.filter((k) => !keep.has(k));
  if (doomed.length > 0) await store.remove(doomed);
  return { deleted: doomed, kept: all.length - doomed.length };
}

function build(params) {
  const env = {
    ...process.env,
    ...params.web.buildEnv,
    VITE_APP_VERSION: process.env.APP_VERSION ?? '',
  };
  execFileSync('pnpm', ['--filter', '@app/web', 'build'], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  statSync(join(root, 'apps/web/dist/index.html'));
  return join(root, 'apps/web/dist');
}

async function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const name = flag('--env');
  if (!name) {
    console.error('✖ cần --env');
    return 2;
  }
  try {
    const { parse } = createRequire(`${root}tooling/package.json`)('yaml');
    const params = parse(readFileSync(`ops/deploy/env/${name}.yaml`, 'utf8'));
    if (params.name !== name)
      throw new Error(`--env "${name}" không khớp name "${params.name}" trong tệp tham số`);
    if (!params.provisioned) throw new Error(`Môi trường ${name} chưa có (provisioned: false)`);
    const store = await awsStore({
      bucket: params.web.bucket,
      endpoint: params.web.s3Endpoint,
      region: params.web.s3Region,
    });
    if (argv.includes('--prune')) {
      const r = await prune({ store });
      console.log(`✔ dọn assets: xóa ${r.deleted.length}, giữ ${r.kept}`);
    } else if (flag('--rollback-to')) {
      await rollback({ store, sha: flag('--rollback-to') });
      console.log(`✔ đã quay về ${flag('--rollback-to').slice(0, 12)}`);
    } else if (argv.includes('--activate')) {
      await activate({ store, sha: flag('--sha') });
      console.log(`✔ đã kích hoạt ${flag('--sha').slice(0, 12)}`);
    } else {
      const sha = flag('--sha');
      if (!sha) throw new Error('cần --sha');
      const manifest = await publish({ store, distDir: build(params), sha });
      console.log(
        `✔ đã tải ${manifest.assets.length} tệp assets + releases/${sha.slice(0, 12)}/ (chưa kích hoạt)`,
      );
    }
    return 0;
  } catch (err) {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
