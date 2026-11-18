// FR-017 (014 T070): KHÔNG điểm cuối HTTP nào trả đường dẫn CÔNG KHAI. Mọi URL trong phản hồi là loại `preview` hạn ≤ 1 giờ và chỉ cho
// media của tài khoản trong phiên. Quét mọi phản hồi của luồng đầy đủ + theo dõi mọi lời gọi `signedUrl` của kho.
import { loc } from '../../src/core/storage';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runWithJobContext } from '../../src/core/context/bind-account';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { QueueLifecycle } from '../../src/modules/queue';
import {
  createTestApp,
  registerAndVerify,
  type Agent,
  type MeBody,
  type TestApp,
} from '../auth/helpers/app';
import { asOwner, describeDb } from '../db/helpers/db';
import { MEDIA, UPLOADS, startBody, startUpload, storageOf, uniqueJpeg } from './helpers';

/** Mọi chuỗi trong một giá trị JSON. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value !== null && typeof value === 'object')
    for (const v of Object.values(value)) strings(v, out);
  return out;
}

describeDb('Không có đường dẫn công khai trong phản hồi HTTP (e2e)', () => {
  let t: TestApp;
  let owner: { agent: Agent; me: MeBody };
  let accountId: string;
  let readyId: string;
  let videoId: string;
  const purposes: string[] = [];

  async function seedReady(kind: 'image' | 'video'): Promise<string> {
    const id = uuidV7();
    await asOwner((c) =>
      c.query(
        `INSERT INTO media.media (id, account_id, kind, status, display_name, original_content_type, original_bytes, uploaded_by_user_id,
            file_hash, width, height, duration_ms, processed_at, normalized_bytes, thumb_bytes)
         VALUES ($1,$2,$3,'ready',$4,$5,5000,$6,$7,640,480,$8,now(),$9,300)`,
        [
          id,
          accountId,
          kind,
          `${kind}.bin`,
          kind === 'image' ? 'image/png' : 'video/mp4',
          owner.me.user.id,
          id.replace(/-/g, '').padEnd(64, 'd'),
          kind === 'video' ? 4000 : null,
          kind === 'image' ? 1200 : null,
        ],
      ),
    );
    await runWithJobContext({ traceId: uuidV7(), accountId }, async () => {
      const s = storageOf(t);
      for (const l of [
        loc.mediaOriginal(id),
        loc.mediaNormalized(id, 'jpeg'),
        loc.mediaThumb(id),
      ]) {
        await s.write(l, Buffer.from('x'), { contentType: 'application/octet-stream' });
      }
    });
    return id;
  }

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    owner = await registerAndVerify(t, { displayName: 'Chị Lan' });
    accountId = owner.me.account.id;
    readyId = await seedReady('image');
    videoId = await seedReady('video');
    // theo dõi MỌI lời gọi cấp đường dẫn ký sẵn của kho
    const storage = storageOf(t);
    const original = storage.signedUrl.bind(storage);
    storage.signedUrl = (l, purpose, ttl) => {
      purposes.push(purpose);
      return original(l, purpose, ttl);
    };
  });
  afterAll(async () => {
    await t.close();
  });

  it('luồng đầy đủ (danh sách, chi tiết ảnh + video, quota, bắt đầu tải một lần và nhiều phần): chỉ URL `preview` ≤ 1 giờ của chính tài khoản', async () => {
    const responses: unknown[] = [];
    const record = async (p: Promise<{ status: number; body: unknown }>) => {
      const res = await p;
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      responses.push(res.body);
      return res;
    };
    await record(owner.agent.get(MEDIA));
    await record(owner.agent.get(`${MEDIA}?kind=video`));
    await record(owner.agent.get(`${MEDIA}/${readyId}`));
    await record(owner.agent.get(`${MEDIA}/${videoId}`));
    await record(owner.agent.get(`${MEDIA}/${readyId}/usages`));
    await record(owner.agent.get(`${MEDIA}/quota`));
    const single = await record(startUpload(owner.agent, uniqueJpeg()));
    const big = await record(
      owner.agent.post(
        UPLOADS,
        startBody({
          name: 'v.mp4',
          bytes: Buffer.alloc(9 * 1024 * 1024),
          contentType: 'video/mp4',
        }),
      ),
    );
    const bigId = (big.body as { uploadId: string }).uploadId;
    await record(owner.agent.post(`${UPLOADS}/${bigId}/part-urls`, { partNumbers: [1, 2] }));
    await record(owner.agent.get(`${UPLOADS}/${(single.body as { uploadId: string }).uploadId}`));

    // (1) mọi lời gọi cấp URL xem nội dung của kho đều là loại `preview`
    expect(purposes.length).toBeGreaterThan(0);
    expect(new Set(purposes)).toEqual(new Set(['preview']));
    expect(purposes).not.toContain('public');

    // (2) mọi URL xem trong phản hồi: hạn ≤ 3600 giây, đúng tiền tố tài khoản trong phiên
    const urls = strings(responses).filter((s) => s.startsWith('memory://get/'));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const u = new URL(url);
      const exp = Number(u.searchParams.get('exp'));
      expect(exp - Date.now(), url).toBeLessThanOrEqual(3_600_000 + 2000);
      const key = decodeURIComponent(u.pathname.replace(/^\//, ''));
      expect(key.startsWith(`tenants/${accountId}/media/`), key).toBe(true);
    }
    // (3) không có chuỗi nào trông như đường dẫn công khai khác (http/https ngoài kho) trong phản hồi
    const external = strings(responses).filter((s) => /^https?:\/\//.test(s));
    expect(external).toEqual([]);
  });

  it('ảnh xem trước của ảnh dùng bản chuẩn hóa, của video dùng tệp gốc; thumbUrl của danh sách là ảnh thu nhỏ', async () => {
    const img = (await owner.agent.get(`${MEDIA}/${readyId}`)).body as { previewUrl: string };
    const vid = (await owner.agent.get(`${MEDIA}/${videoId}`)).body as { previewUrl: string };
    const keyOf = (url: string) => decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
    expect(keyOf(img.previewUrl)).toBe(`tenants/${accountId}/media/${readyId}/normalized/jpeg`);
    expect(keyOf(vid.previewUrl)).toBe(`tenants/${accountId}/media/${videoId}/original`);
    const list = (await owner.agent.get(MEDIA)).body as {
      items: { id: string; thumbUrl: string | null }[];
    };
    const thumb = list.items.find((i) => i.id === readyId)!.thumbUrl!;
    expect(keyOf(thumb)).toBe(`tenants/${accountId}/media/${readyId}/thumb`);
  });

  it('không có điểm cuối nào để lấy URL công khai: các đường dẫn thử đều 404', async () => {
    for (const path of [
      `${MEDIA}/${readyId}/public-url`,
      `${MEDIA}/${readyId}/public`,
      `${MEDIA}/public-url`,
    ]) {
      const res = await owner.agent.get(path);
      expect(res.status, path).toBeGreaterThanOrEqual(400);
    }
  });
});
