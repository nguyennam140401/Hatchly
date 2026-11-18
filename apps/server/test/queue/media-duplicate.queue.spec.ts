// US7 – tệp trùng nội dung không tốn chỗ và không xử lý lại (014 T083, FR-020, R3, SC-008): dấu SHA-256 tính ở Worker; trùng trong CÙNG
// tài khoản ⇒ hoàn dung lượng, bỏ dòng mới, báo "đã có", KHÔNG chạy xử lý ảnh/video; tài khoản khác có bản riêng, không tiết lộ nhau.
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { loc } from '../../src/core/storage';
import { MemoryObjectStorage } from '../../src/core/storage/memory/memory-storage';
import { createProcessMediaHandler } from '../../src/modules/media/internal/process.handler';
import { createPurgeFilesHandler } from '../../src/modules/media/internal/purge.handler';
import { QuotaStore } from '../../src/modules/media/internal/quota.store';
import { processMedia, purgeMediaFiles } from '../../src/modules/media/jobs';
import { registerJobHandler } from '../../src/modules/queue';
import { unregisterJobHandler } from '../../src/modules/queue/internal/handlers';
import { expectIdempotent, runJobInline, startTestProducer } from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const fx = (name: string): Buffer => readFileSync(resolve(__dirname, '../fixtures/media', name));

describeDb('Việc media.process – tệp trùng nội dung', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  const storage = new MemoryObjectStorage();
  const quota = new QuotaStore(5 * 1024 ** 3);
  let tmpRoot: string;
  let a: string;
  const logs: Record<string, unknown>[] = [];

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 8 });
    stopProducer = await startTestProducer();
    tmpRoot = mkdtempSync(join(tmpdir(), 'media-dup-'));
    const log = {
      info: (e: Record<string, unknown>) => logs.push(e),
      warn: (e: Record<string, unknown>) => logs.push(e),
    };
    const h = createProcessMediaHandler({ storage, quota, log, tmpRoot: () => tmpRoot });
    unregisterJobHandler(processMedia.name);
    registerJobHandler(processMedia, h.handler, { onFinalFailure: h.onFinalFailure });
    unregisterJobHandler(purgeMediaFiles.name);
    registerJobHandler(
      purgeMediaFiles,
      createPurgeFilesHandler({ storage, log: { info: () => undefined } }),
    );
  });
  afterAll(async () => {
    unregisterJobHandler(processMedia.name);
    unregisterJobHandler(purgeMediaFiles.name);
    await stopProducer();
    await database.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetQueues();
    logs.length = 0;
    a = await createAccount();
  });

  /** Mồi media `processing` + phiên `completed` + tệp gốc + dung lượng đã chốt. */
  async function seed(acc: string, name: string, body: Buffer) {
    const mediaId = uuidV7();
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO media.media (id, account_id, kind, status, display_name, original_content_type, original_bytes, uploaded_by_user_id)
         VALUES ($1,$2,'image','processing',$3,'image/png',$4,$5)`,
        [mediaId, acc, name, body.length, uuidV7()],
      );
      await c.query(
        `INSERT INTO media.upload_sessions (id, account_id, media_id, created_by_user_id, fingerprint, mode, declared_bytes,
            declared_content_type, state, expires_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,'single',$6,'image/png','completed', now() + interval '1 day', now())`,
        [uuidV7(), acc, mediaId, uuidV7(), mediaId.replace(/-/g, '').padEnd(64, '1'), body.length],
      );
      await c.query(
        `INSERT INTO media.storage_quotas (id, account_id, used_bytes, limit_bytes) VALUES ($1,$2,$3,5368709120)
         ON CONFLICT (account_id) DO UPDATE SET used_bytes = media.storage_quotas.used_bytes + $3`,
        [uuidV7(), acc, body.length],
      );
    });
    await withAccount(acc, () =>
      storage.write(loc.mediaOriginal(mediaId), body, { contentType: 'image/png' }),
    );
    return mediaId;
  }

  const run = (acc: string, mediaId: string) =>
    runJobInline(processMedia, { mediaId }, { accountId: acc });
  const rowOf = (id: string) =>
    asOwner(async (c) => {
      const r = await c.query<{
        status: string;
        deleted_at: Date | null;
        file_hash: string | null;
      }>('SELECT status, deleted_at, file_hash FROM media.media WHERE id = $1', [id]);
      return r.rows[0]!;
    });
  const sessionOf = (id: string) =>
    asOwner(async (c) => {
      const r = await c.query<{ state: string; duplicate_of_media_id: string | null }>(
        'SELECT state, duplicate_of_media_id FROM media.upload_sessions WHERE media_id = $1',
        [id],
      );
      return r.rows[0]!;
    });
  const used = (acc: string) =>
    asOwner(async (c) =>
      Number(
        (
          await c.query<{ u: string }>(
            'SELECT used_bytes::text AS u FROM media.storage_quotas WHERE account_id = $1',
            [acc],
          )
        ).rows[0]?.u ?? 0,
      ),
    );
  const has = (acc: string, id: string, which: 'original' | 'normalized' | 'thumb') =>
    withAccount(
      acc,
      async () =>
        (
          await storage.stat(
            which === 'original'
              ? loc.mediaOriginal(id)
              : which === 'thumb'
                ? loc.mediaThumb(id)
                : loc.mediaNormalized(id, 'jpeg'),
          )
        ).exists,
    );

  it('tải lại đúng nội dung (đổi tên) ⇒ phiên "duplicate" trỏ tới tệp đã có; dung lượng tính MỘT lần; KHÔNG xử lý ảnh', async () => {
    const body = fx('plain.png');
    const first = await seed(a, 'Áo dài.png', body);
    await run(a, first);
    expect((await rowOf(first)).status).toBe('ready');
    expect(await used(a)).toBe(body.length);

    const second = await seed(a, 'ao-dai-copy-doi-ten.png', body);
    expect(await used(a)).toBe(2 * body.length); // đã chốt tạm lúc xác nhận
    logs.length = 0;
    expect(await run(a, second)).toBeUndefined();

    // tệp đã có không bị đụng tới
    expect(await rowOf(first)).toMatchObject({ status: 'ready', deleted_at: null });
    expect(await sessionOf(second)).toEqual({ state: 'duplicate', duplicate_of_media_id: first });
    // dòng mới bị bỏ (xóa mềm), dung lượng hoàn lại, không dấu tệp ⇒ không chiếm chỉ mục
    const dup = await rowOf(second);
    expect(dup.deleted_at).not.toBeNull();
    expect(dup.file_hash).toBeNull();
    expect(await used(a)).toBe(body.length);
    // KHÔNG chạy xử lý ảnh: không có bản phái sinh, không nhật ký "ready"
    expect(await has(a, second, 'normalized')).toBe(false);
    expect(await has(a, second, 'thumb')).toBe(false);
    expect(logs.some((l) => l.msg === 'media.process.ready')).toBe(false);
    expect(logs.some((l) => l.msg === 'media.process.duplicate')).toBe(true);
    // tên hiển thị của tệp có sẵn giữ nguyên
    const name = await asOwner(
      async (c) =>
        (
          await c.query<{ display_name: string }>(
            'SELECT display_name FROM media.media WHERE id = $1',
            [first],
          )
        ).rows[0]?.display_name,
    );
    expect(name).toBe('Áo dài.png');
  });

  it('tệp dở của dòng trùng bị xóa bằng việc purge (không đụng tệp của media đã có)', async () => {
    const body = fx('plain.png');
    const first = await seed(a, 'a.png', body);
    await run(a, first);
    const second = await seed(a, 'b.png', body);
    await run(a, second);
    const purge = await jobs(
      `data->>'type' = 'media.purge_files' AND data->'payload'->>'mediaId' = $1`,
      [second],
    );
    expect(purge).toHaveLength(1);
    expect(purge[0]!.data.accountId).toBe(a);
    await runJobInline(purgeMediaFiles, { mediaId: second }, { accountId: a });
    expect(await has(a, second, 'original')).toBe(false);
    expect(await has(a, first, 'original')).toBe(true);
    expect(await has(a, first, 'normalized')).toBe(true);
  });

  it('chạy lại hai lần cho cùng kết quả (expectIdempotent): không trả dung lượng hai lần', async () => {
    const body = fx('plain.webp');
    const first = await seed(a, 'a.webp', body);
    await run(a, first);
    const second = await seed(a, 'b.webp', body);
    await expectIdempotent(
      processMedia,
      { mediaId: second },
      {
        accountId: a,
        snapshot: async () => ({
          used: await used(a),
          s: await sessionOf(second),
          d: (await rowOf(second)).deleted_at !== null,
        }),
      },
    );
    expect(await used(a)).toBe(body.length);
  });

  it('hai thiết bị tải cùng nội dung gần đồng thời ⇒ còn đúng MỘT media, dung lượng tính một lần', async () => {
    const body = fx('plain.png');
    const x = await seed(a, 'x.png', body);
    const y = await seed(a, 'y.png', body);
    await Promise.all([run(a, x), run(a, y)]);
    const rows = [await rowOf(x), await rowOf(y)];
    expect(rows.filter((r) => r.deleted_at === null)).toHaveLength(1);
    expect(rows.filter((r) => r.deleted_at !== null)).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'ready')).toHaveLength(1);
    expect(await used(a)).toBe(body.length);
    const sessions = [await sessionOf(x), await sessionOf(y)];
    expect(sessions.filter((s) => s.state === 'duplicate')).toHaveLength(1);
    expect(sessions.filter((s) => s.state === 'completed')).toHaveLength(1);
  });

  it('tệp đã XÓA rồi tải lại ⇒ xem như tệp mới (không chiếm dấu)', async () => {
    const body = fx('plain.png');
    const first = await seed(a, 'a.png', body);
    await run(a, first);
    await asOwner((c) =>
      c.query('UPDATE media.media SET deleted_at = now() WHERE id = $1', [first]),
    );
    const again = await seed(a, 'a-lai.png', body);
    await run(a, again);
    expect((await rowOf(again)).status).toBe('ready');
    expect((await sessionOf(again)).state).toBe('completed');
  });

  it('tệp "không xử lý được" không chiếm dấu: tải lại nội dung tốt đó là tệp mới', async () => {
    const bad = Buffer.from('không phải ảnh nhưng đủ dài để thử xử lý 0123456789');
    const broken = await seed(a, 'hong.png', bad);
    await run(a, broken);
    expect((await rowOf(broken)).status).toBe('unprocessable');
    const good = await seed(a, 'tot.png', fx('plain.png'));
    await run(a, good);
    expect((await rowOf(good)).status).toBe('ready');
  });

  it('CÔ LẬP: tài khoản B tải cùng nội dung ⇒ bản riêng đầy đủ, không biết A đã có (không phiên "duplicate")', async () => {
    const body = fx('plain.png');
    const b = await createAccount();
    const mine = await seed(a, 'a.png', body);
    await run(a, mine);
    const theirs = await seed(b, 'b.png', body);
    await run(b, theirs);
    expect((await rowOf(theirs)).status).toBe('ready');
    expect((await sessionOf(theirs)).state).toBe('completed');
    expect((await sessionOf(theirs)).duplicate_of_media_id).toBeNull();
    expect(await has(b, theirs, 'normalized')).toBe(true);
    expect(await used(b)).toBe(body.length);
    // cùng dấu tệp ở hai tài khoản
    const hashes = await asOwner(
      async (c) =>
        (
          await c.query('SELECT DISTINCT file_hash FROM media.media WHERE id = ANY($1)', [
            [mine, theirs],
          ])
        ).rows.length,
    );
    expect(hashes).toBe(1);
    expect(createHash('sha256').update(body).digest('hex')).toBe((await rowOf(mine)).file_hash);
  });
});
