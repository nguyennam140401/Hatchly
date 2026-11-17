// Nhóm (h) – việc nền `media.purge_files` và quét tuần `media.cleanup` (scope `full`) (014 T075, FR-021/022/028, SC-009, R7):
// xóa tệp thật sau khi xóa mềm, xóa HẲN dòng > 30 ngày, tệp mồ côi, bản ghi mất tệp, đối soát bộ đếm. Chạy lại an toàn.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { loc } from '../../src/core/storage';
import { MemoryObjectStorage } from '../../src/core/storage/memory/memory-storage';
import { createCleanupHandler } from '../../src/modules/media/internal/cleanup.handler';
import { createPurgeFilesHandler } from '../../src/modules/media/internal/purge.handler';
import { QuotaStore } from '../../src/modules/media/internal/quota.store';
import { cleanupMedia, purgeMediaFiles } from '../../src/modules/media/jobs';
import { registerJobHandler } from '../../src/modules/queue';
import { unregisterJobHandler } from '../../src/modules/queue/internal/handlers';
import { expectIdempotent, runJobInline, startTestProducer } from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  resetQueues,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const DAY = 86_400_000;

describeDb('Việc media.purge_files và quét tuần media.cleanup', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let offsetMs = 0;
  const clock = () => new Date(Date.now() + offsetMs);
  const storage = new MemoryObjectStorage(clock);
  const quota = new QuotaStore(5 * 1024 ** 3);
  let drift: number[] = [];
  let accountId: string;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 8 });
    stopProducer = await startTestProducer();
    const cleanup = createCleanupHandler({
      storage,
      quota,
      now: clock,
      onDrift: (b) => drift.push(b),
      log: { info: () => undefined, warn: () => undefined },
    });
    unregisterJobHandler(cleanupMedia.name);
    registerJobHandler(cleanupMedia, async (p) => {
      await cleanup(p);
    });
    unregisterJobHandler(purgeMediaFiles.name);
    registerJobHandler(
      purgeMediaFiles,
      createPurgeFilesHandler({ storage, log: { info: () => undefined } }),
    );
  });
  afterAll(async () => {
    unregisterJobHandler(cleanupMedia.name);
    unregisterJobHandler(purgeMediaFiles.name);
    await stopProducer();
    await database.close();
  });
  beforeEach(async () => {
    await resetQueues();
    offsetMs = 0;
    drift = [];
    accountId = await createAccount();
  });

  /** Media + (tùy chọn) đủ 3 tệp trong kho. */
  async function seed(opts: {
    status?: 'ready' | 'unprocessable';
    deletedAgoDays?: number | null;
    purged?: boolean;
    files?: boolean;
    bytes?: number;
  }) {
    const mediaId = uuidV7();
    const bytes = opts.bytes ?? 1000;
    const status = opts.status ?? 'ready';
    await asOwner((c) =>
      c.query(
        `INSERT INTO media.media (id, account_id, kind, status, display_name, original_content_type, original_bytes, uploaded_by_user_id,
            file_hash, width, height, processed_at, normalized_bytes, thumb_bytes, failure_code, deleted_at, files_purged_at)
         VALUES ($1,$2,'image',$3,'a.jpg','image/jpeg',$4,$5,
            $6, $7, $7, now(), $8, $8, $9,
            CASE WHEN $10::int IS NULL THEN NULL ELSE now() - ($10 || ' days')::interval END,
            CASE WHEN $11::boolean THEN now() ELSE NULL END)`,
        [
          mediaId,
          accountId,
          status,
          bytes,
          uuidV7(),
          status === 'ready' ? mediaId.replace(/-/g, '').padEnd(64, 'a') : null,
          status === 'ready' ? 100 : null,
          status === 'ready' ? 10 : null,
          status === 'unprocessable' ? 'corrupt' : null,
          opts.deletedAgoDays ?? null,
          opts.purged ?? false,
        ],
      ),
    );
    if (opts.files !== false) {
      await withAccount(accountId, async () => {
        await storage.write(loc.mediaOriginal(mediaId), Buffer.alloc(8), {
          contentType: 'image/jpeg',
        });
        await storage.write(loc.mediaNormalized(mediaId, 'jpeg'), Buffer.alloc(8), {
          contentType: 'image/jpeg',
        });
        await storage.write(loc.mediaThumb(mediaId), Buffer.alloc(8), {
          contentType: 'image/jpeg',
        });
      });
    }
    return mediaId;
  }

  const has = (mediaId: string) =>
    withAccount(accountId, async () => ({
      original: (await storage.stat(loc.mediaOriginal(mediaId))).exists,
      normalized: (await storage.stat(loc.mediaNormalized(mediaId, 'jpeg'))).exists,
      thumb: (await storage.stat(loc.mediaThumb(mediaId))).exists,
    }));
  const rowOf = (mediaId: string) =>
    asOwner(async (c) => {
      const r = await c.query<{
        status: string;
        failure_code: string | null;
        files_purged_at: Date | null;
      }>('SELECT status, failure_code, files_purged_at FROM media.media WHERE id = $1', [mediaId]);
      return r.rows[0] ?? null;
    });
  const setQuota = (used: number, reserved = 0) =>
    asOwner((c) =>
      c.query(
        `INSERT INTO media.storage_quotas (id, account_id, used_bytes, reserved_bytes, limit_bytes) VALUES ($1,$2,$3,$4,5368709120)
         ON CONFLICT (account_id) DO UPDATE SET used_bytes = $3, reserved_bytes = $4`,
        [uuidV7(), accountId, used, reserved],
      ),
    );
  const quotaRow = () =>
    asOwner(async (c) => {
      const r = await c.query<{ u: string; r: string }>(
        'SELECT used_bytes::text AS u, reserved_bytes::text AS r FROM media.storage_quotas WHERE account_id = $1',
        [accountId],
      );
      return { used: Number(r.rows[0]!.u), reserved: Number(r.rows[0]!.r) };
    });

  describe('media.purge_files', () => {
    it('xóa đủ gốc + chuẩn hóa + thu nhỏ của media đã xóa mềm, đặt files_purged_at; chạy lại hai lần không lỗi', async () => {
      const id = await seed({ deletedAgoDays: 0 });
      expect(await has(id)).toEqual({ original: true, normalized: true, thumb: true });
      await expectIdempotent(
        purgeMediaFiles,
        { mediaId: id },
        {
          accountId,
          snapshot: async () => ({
            files: await has(id),
            row: (await rowOf(id))?.files_purged_at !== null,
          }),
        },
      );
      expect(await has(id)).toEqual({ original: false, normalized: false, thumb: false });
      expect((await rowOf(id))!.files_purged_at).not.toBeNull();
    });

    it('thiếu một số tệp (xóa đối tượng không có) ⇒ không lỗi', async () => {
      const id = await seed({ deletedAgoDays: 0, files: false });
      await withAccount(accountId, () =>
        storage.write(loc.mediaThumb(id), Buffer.alloc(4), { contentType: 'image/jpeg' }),
      );
      await expect(
        runJobInline(purgeMediaFiles, { mediaId: id }, { accountId }),
      ).resolves.toBeUndefined();
      expect((await has(id)).thumb).toBe(false);
    });

    it('media CHƯA xóa mềm ⇒ KHÔNG bao giờ xóa tệp (việc lạc không làm mất dữ liệu)', async () => {
      const id = await seed({});
      await runJobInline(purgeMediaFiles, { mediaId: id }, { accountId });
      expect(await has(id)).toEqual({ original: true, normalized: true, thumb: true });
      expect((await rowOf(id))!.files_purged_at).toBeNull();
    });

    it('không có dòng (đã xóa hẳn) ⇒ bỏ qua', async () => {
      await expect(
        runJobInline(purgeMediaFiles, { mediaId: uuidV7() }, { accountId }),
      ).resolves.toBeUndefined();
    });
  });

  describe('media.cleanup scope full', () => {
    const full = () => runJobInline(cleanupMedia, { scope: 'full' as const }, { accountId });

    it('xóa HẲN dòng đã xóa mềm > 30 ngày (tệp thật đã purge); dòng mới hơn 30 ngày được giữ', async () => {
      const old = await seed({ deletedAgoDays: 31, purged: true, files: false });
      const recent = await seed({ deletedAgoDays: 10, purged: true, files: false });
      const live = await seed({ files: false });
      await setQuota(1000);
      await full();
      expect(await rowOf(old)).toBeNull();
      expect(await rowOf(recent)).not.toBeNull();
      expect(await rowOf(live)).not.toBeNull();
    });

    it('tệp MỒ CÔI trong kho (không có bản ghi, cũ > 1 ngày) bị xóa; tệp mới và tệp có bản ghi được giữ', async () => {
      const kept = await seed({});
      const orphan = uuidV7();
      await withAccount(accountId, () =>
        storage.write(loc.mediaOriginal(orphan), Buffer.alloc(8), { contentType: 'image/jpeg' }),
      );
      offsetMs = 2 * DAY; // tệp mồ côi giờ cũ hơn 1 ngày
      const fresh = uuidV7();
      await withAccount(accountId, () =>
        storage.write(loc.mediaOriginal(fresh), Buffer.alloc(8), { contentType: 'image/jpeg' }),
      );
      await setQuota(1000);
      await full();
      expect((await has(orphan)).original).toBe(false);
      expect((await has(fresh)).original).toBe(true); // mới tải – có thể đang được dùng
      expect((await has(kept)).original).toBe(true);
    });

    it('bản ghi ready mà tệp gốc MẤT ⇒ "Không xử lý được" (storage_mismatch) + trả dung lượng, một lần', async () => {
      const lost = await seed({ files: false, bytes: 700 });
      const fine = await seed({ bytes: 300 });
      await setQuota(1000);
      await full();
      expect(await rowOf(lost)).toMatchObject({
        status: 'unprocessable',
        failure_code: 'storage_mismatch',
      });
      expect((await rowOf(fine))!.status).toBe('ready');
      expect(await quotaRow()).toEqual({ used: 300, reserved: 0 });
      await full();
      expect(await quotaRow()).toEqual({ used: 300, reserved: 0 }); // không trả lần hai
    });

    it('đối soát bộ đếm: lệch ⇒ ghi độ lệch + sửa đúng tổng thực; chạy lại không lệch nữa', async () => {
      await seed({ bytes: 400 });
      await seed({ bytes: 600 });
      await seed({ status: 'unprocessable', bytes: 5000 }); // đã trả ⇒ không tính
      await seed({ deletedAgoDays: 1, purged: true, files: false, bytes: 9999 }); // đã xóa ⇒ không tính
      await setQuota(7777, 55); // lệch cả dung lượng đã dùng lẫn giữ chỗ
      await full();
      expect(await quotaRow()).toEqual({ used: 1000, reserved: 0 });
      expect(drift).toEqual([Math.abs(1000 - 7777) + 55]);
      drift = [];
      await full();
      expect(drift).toEqual([]);
      expect(await quotaRow()).toEqual({ used: 1000, reserved: 0 });
    });

    it('chạy lại hai lần cho cùng kết quả (expectIdempotent)', async () => {
      await seed({ deletedAgoDays: 40, purged: true, files: false });
      await seed({ files: false, bytes: 200 });
      await seed({ bytes: 300 });
      await setQuota(800);
      await expectIdempotent(
        cleanupMedia,
        { scope: 'full' as const },
        {
          accountId,
          snapshot: async () => ({
            q: await quotaRow(),
            rows: await asOwner(
              async (c) =>
                (
                  await c.query(
                    'SELECT status, deleted_at IS NOT NULL AS d FROM media.media WHERE account_id = $1 ORDER BY status, d',
                    [accountId],
                  )
                ).rows,
            ),
          }),
        },
      );
    });

    it('cô lập tenant: dọn tài khoản A không đụng tệp/bản ghi của B', async () => {
      const other = await createAccount();
      const otherId = uuidV7();
      await asOwner((c) =>
        c.query(
          `INSERT INTO media.media (id, account_id, kind, status, display_name, original_content_type, original_bytes, uploaded_by_user_id,
              file_hash, width, height, processed_at, normalized_bytes, thumb_bytes)
           VALUES ($1,$2,'image','ready','b.jpg','image/jpeg',500,$3,$4,10,10,now(),1,1)`,
          [otherId, other, uuidV7(), 'b'.repeat(64)],
        ),
      );
      await withAccount(other, () =>
        storage.write(loc.mediaOriginal(otherId), Buffer.alloc(8), { contentType: 'image/jpeg' }),
      );
      await setQuota(0);
      await full();
      expect((await rowOf(otherId))!.status).toBe('ready');
      expect(
        await withAccount(
          other,
          async () => (await storage.stat(loc.mediaOriginal(otherId))).exists,
        ),
      ).toBe(true);
    });
  });
});
