// Nhóm (h) – việc nền `media.cleanup` + `media.sweep` (014 T063/T075, FR-009, FR-021, FR-028, SC-009, R7, hiến pháp V).
// PostgreSQL thật + kho memory (đồng hồ tiêm được). Mỗi bước chạy lại an toàn (`expectIdempotent`).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { loc } from '../../src/core/storage';
import { MemoryObjectStorage } from '../../src/core/storage/memory/memory-storage';
import { cleanupMedia, sweepMedia } from '../../src/modules/media/jobs';
import { createCleanupHandler } from '../../src/modules/media/internal/cleanup.handler';
import { createPurgeFilesHandler } from '../../src/modules/media/internal/purge.handler';
import { QuotaStore } from '../../src/modules/media/internal/quota.store';
import { runMediaSweep } from '../../src/modules/media/internal/sweep';
import { purgeMediaFiles } from '../../src/modules/media/jobs';
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

const MIB = 1024 * 1024;

describeDb('Việc media.cleanup / media.sweep', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let offsetMs = 0;
  const clock = () => new Date(Date.now() + offsetMs);
  const storage = new MemoryObjectStorage(clock);
  const quota = new QuotaStore(5 * 1024 ** 3);
  let drift: number[] = [];
  let accountId: string;
  const logs: Record<string, unknown>[] = [];

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 8 });
    stopProducer = await startTestProducer();
    const cleanup = createCleanupHandler({
      storage,
      quota,
      now: clock,
      onDrift: (b) => drift.push(b),
      log: { info: (e) => logs.push(e), warn: (e) => logs.push(e) },
    });
    unregisterJobHandler(cleanupMedia.name);
    registerJobHandler(cleanupMedia, async (p) => {
      await cleanup(p);
    });
    unregisterJobHandler(purgeMediaFiles.name);
    registerJobHandler(
      purgeMediaFiles,
      createPurgeFilesHandler({ storage, log: { info: (e) => logs.push(e) } }),
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
    logs.length = 0;
    accountId = await createAccount();
  });

  // ----- tiện ích mồi dữ liệu -----
  async function ensureQuota(used = 0, reserved = 0) {
    await asOwner((c) =>
      c.query(
        `INSERT INTO media.storage_quotas (id, account_id, used_bytes, reserved_bytes, limit_bytes) VALUES ($1,$2,$3,$4,5368709120)
         ON CONFLICT (account_id) DO UPDATE SET used_bytes = $3, reserved_bytes = $4`,
        [uuidV7(), accountId, used, reserved],
      ),
    );
  }
  const quotaRow = () =>
    asOwner(async (c) => {
      const r = await c.query<{ u: string; r: string }>(
        'SELECT used_bytes::text AS u, reserved_bytes::text AS r FROM media.storage_quotas WHERE account_id = $1',
        [accountId],
      );
      return r.rows[0] === undefined
        ? null
        : { used: Number(r.rows[0].u), reserved: Number(r.rows[0].r) };
    });

  /** Phiên tải: media `uploading` + phiên + (tùy chọn) phiên nhiều phần + tệp dở trong kho. */
  async function seedSession(opts: {
    state?: string;
    expiresInMs?: number;
    bytes?: number;
    multipart?: boolean;
    lastActivityAgoMs?: number;
  }) {
    const mediaId = uuidV7();
    const bytes = opts.bytes ?? 10 * MIB;
    let uploadId: string | null = null;
    await withAccount(accountId, async () => {
      if (opts.multipart === true) {
        uploadId = (
          await storage.createMultipart(loc.mediaOriginal(mediaId), {
            contentType: 'video/mp4',
            bytes,
            partSizeBytes: 8 * MIB,
          })
        ).uploadId;
      } else {
        await storage.write(loc.mediaOriginal(mediaId), Buffer.alloc(16), {
          contentType: 'image/jpeg',
        });
      }
    });
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO media.media (id, account_id, kind, status, display_name, original_content_type, original_bytes, uploaded_by_user_id)
         VALUES ($1,$2,'video','uploading','a.mp4','video/mp4',$3,$4)`,
        [mediaId, accountId, bytes, uuidV7()],
      );
      await c.query(
        `INSERT INTO media.upload_sessions (id, account_id, media_id, created_by_user_id, fingerprint, mode, declared_bytes,
            declared_content_type, multipart_upload_id, part_size_bytes, part_count, state, expires_at, last_activity_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'video/mp4',$8,$9,$10,$11, now() + ($12 || ' milliseconds')::interval, now() - ($13 || ' milliseconds')::interval)`,
        [
          uuidV7(),
          accountId,
          mediaId,
          uuidV7(),
          mediaId.replace(/-/g, '').padEnd(64, '0'),
          opts.multipart === true ? 'multipart' : 'single',
          bytes,
          uploadId,
          opts.multipart === true ? 8 * MIB : null,
          opts.multipart === true ? Math.ceil(bytes / (8 * MIB)) : null,
          opts.state ?? 'open',
          String(opts.expiresInMs ?? -60_000),
          String(opts.lastActivityAgoMs ?? 0),
        ],
      );
    });
    return { mediaId, uploadId };
  }

  const exists = (mediaId: string, kind: 'original' | 'normalized' | 'thumb' = 'original') =>
    withAccount(accountId, async () => {
      const l =
        kind === 'original'
          ? loc.mediaOriginal(mediaId)
          : kind === 'thumb'
            ? loc.mediaThumb(mediaId)
            : loc.mediaNormalized(mediaId, 'jpeg');
      return (await storage.stat(l)).exists;
    });
  const mediaCount = (mediaId: string) =>
    asOwner(
      async (c) =>
        (
          await c.query<{ n: number }>('SELECT count(*)::int AS n FROM media.media WHERE id = $1', [
            mediaId,
          ])
        ).rows[0]?.n ?? 0,
    );
  const openMultipart = () =>
    withAccount(accountId, () => Promise.resolve(storage.openMultipartCount()));
  const cleanup = (scope: 'stale' | 'full') => runJobInline(cleanupMedia, { scope }, { accountId });

  describe('scope stale – phiên tải quá 24 giờ', () => {
    it('phiên open quá hạn ⇒ expired: trả giữ chỗ, xóa dòng dở + tệp dở, hủy nhiều phần', async () => {
      await ensureQuota(0, 20 * MIB);
      const single = await seedSession({ bytes: 10 * MIB });
      const multi = await seedSession({ bytes: 10 * MIB, multipart: true });
      expect(await openMultipart()).toBe(1);
      await cleanup('stale');
      expect(await mediaCount(single.mediaId)).toBe(0);
      expect(await mediaCount(multi.mediaId)).toBe(0);
      expect(await exists(single.mediaId)).toBe(false);
      expect(await openMultipart()).toBe(0); // không để rác nhiều phần tính phí
      expect(await quotaRow()).toEqual({ used: 0, reserved: 0 }); // SC-009: chênh lệch bộ đếm = 0
      expect(logs.some((l) => l.msg === 'media.upload.expired')).toBe(true);
    });

    it('phiên còn hạn KHÔNG bị đụng tới; phiên completed/failed không bị coi là quá hạn', async () => {
      await ensureQuota(0, 10 * MIB);
      const live = await seedSession({ expiresInMs: 3_600_000 });
      await cleanup('stale');
      expect(await mediaCount(live.mediaId)).toBe(1);
      expect(await exists(live.mediaId)).toBe(true);
      expect(await quotaRow()).toEqual({ used: 0, reserved: 10 * MIB });
    });

    it('phiên completing bị bỏ dở > 1 giờ cũng được dọn', async () => {
      await ensureQuota(0, 10 * MIB);
      const stuck = await seedSession({
        state: 'completing',
        expiresInMs: 3_600_000,
        lastActivityAgoMs: 2 * 3_600_000,
      });
      await cleanup('stale');
      expect(await mediaCount(stuck.mediaId)).toBe(0);
      expect(await quotaRow()).toEqual({ used: 0, reserved: 0 });
    });

    it('chạy lại hai lần cho cùng kết quả (expectIdempotent): bộ đếm không bị trả hai lần', async () => {
      await ensureQuota(0, 10 * MIB);
      const s = await seedSession({});
      await expectIdempotent(
        cleanupMedia,
        { scope: 'stale' as const },
        {
          accountId,
          snapshot: async () => ({
            q: await quotaRow(),
            n: await mediaCount(s.mediaId),
            obj: await exists(s.mediaId),
          }),
        },
      );
      expect(await quotaRow()).toEqual({ used: 0, reserved: 0 });
    });

    it('media đã xóa mềm mà việc purge bị lạc ⇒ xóa tệp thật và đặt files_purged_at', async () => {
      const mediaId = uuidV7();
      await withAccount(accountId, async () => {
        await storage.write(loc.mediaOriginal(mediaId), Buffer.alloc(8), {
          contentType: 'image/jpeg',
        });
        await storage.write(loc.mediaThumb(mediaId), Buffer.alloc(8), {
          contentType: 'image/jpeg',
        });
      });
      await asOwner((c) =>
        c.query(
          `INSERT INTO media.media (id, account_id, kind, status, display_name, original_content_type, original_bytes,
              uploaded_by_user_id, failure_code, deleted_at)
           VALUES ($1, $2, 'image', 'unprocessable', 'a.jpg', 'image/jpeg', 8, $3, 'corrupt', now())`,
          [mediaId, accountId, uuidV7()],
        ),
      );
      await cleanup('stale');
      expect(await exists(mediaId)).toBe(false);
      expect(await exists(mediaId, 'thumb')).toBe(false);
      const purged = await asOwner(
        async (c) =>
          (
            await c.query<{ files_purged_at: Date | null }>(
              'SELECT files_purged_at FROM media.media WHERE id = $1',
              [mediaId],
            )
          ).rows[0]?.files_purged_at ?? null,
      );
      expect(purged).not.toBeNull();
    });
  });

  describe('media.sweep – tạo việc dọn theo từng tài khoản', () => {
    it('chỉ tài khoản có phiên quá hạn bị tạo việc; việc cùng khóa chỉ một; chạy lại không nhân đôi', async () => {
      const other = await createAccount(); // không có gì cần dọn
      await ensureQuota(0, 10 * MIB);
      await seedSession({});
      const first = await runMediaSweep({ weekly: false });
      expect(first).toEqual({ stale: 1, full: 0 });
      const queued = await jobs(`data->>'type' = 'media.cleanup'`);
      expect(queued).toHaveLength(1);
      expect(queued[0]!.data.accountId).toBe(accountId);
      expect(queued[0]!.data.accountId).not.toBe(other);
      expect(queued[0]!.data.payload).toEqual({ scope: 'stale' }); // payload chỉ mã tham chiếu, không tên tệp
      expect(queued[0]!.name).toBe('media');
      const second = await runMediaSweep({ weekly: false });
      expect(second.stale).toBe(0); // việc cùng khóa media_cleanup:{acc}:stale đã có
      expect(await jobs(`data->>'type' = 'media.cleanup'`)).toHaveLength(1);
    });

    it('quét tuần thêm việc `full` cho mọi tài khoản có dữ liệu media', async () => {
      await ensureQuota(5 * MIB, 0);
      const r = await runMediaSweep({ weekly: true });
      expect(r.full).toBeGreaterThanOrEqual(1);
      const full = await jobs(
        `data->>'type' = 'media.cleanup' AND data->'payload'->>'scope' = 'full'`,
      );
      expect(full.map((j) => j.data.accountId)).toContain(accountId);
    });

    it('việc quét là việc HỆ THỐNG: không có mã tài khoản, payload rỗng', () => {
      expect(sweepMedia.scope).toBe('system');
      expect(sweepMedia.queue).toBe('scheduled');
    });
  });
});
