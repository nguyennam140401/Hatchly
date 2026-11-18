// Clarifications / edge case: xóa hẳn tài khoản → dữ liệu tenant của nó biến mất (ON DELETE CASCADE)
// trong cùng giao dịch; dữ liệu tài khoản khác và nhật ký kiểm toán còn nguyên.
import { expect, it } from 'vitest';
import { loadConfig } from '../../src/core/config/load-config';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { loc } from '../../src/core/storage';
import { MemoryObjectStorage } from '../../src/core/storage/memory/memory-storage';
import { MediaPublicApiImpl } from '../../src/modules/media/internal/public-api.impl';
import {
  asOwner,
  countByAccount,
  createAccount,
  dbUrls,
  describeDb,
  seedNotes,
  withAccount,
} from './helpers/db';

describeDb('Xóa hẳn tài khoản', () => {
  it('xóa accounts A bằng owner → mọi dòng của A ở tenant_notes mất; dòng B, audit_log của A còn', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await seedNotes(a, 3);
    await seedNotes(b, 2);
    await asOwner((c) =>
      c.query(
        `INSERT INTO infra.audit_log (id, account_id, actor_type, actor_id, action, reason)
         VALUES ($1, $2, 'support', 'nv-1', 'support.view_account', 'kiểm tra lỗi')`,
        [uuidV7(), a],
      ),
    );

    await asOwner(async (c) => {
      await c.query('BEGIN');
      await c.query('DELETE FROM account.accounts WHERE id = $1', [a]);
      // Trong CÙNG giao dịch, dòng con đã mất.
      const inside = await c.query('SELECT 1 FROM sandbox.tenant_notes WHERE account_id = $1', [a]);
      expect(inside.rowCount).toBe(0);
      await c.query('COMMIT');
    });

    const counts = await countByAccount('sandbox.tenant_notes');
    expect(counts[a]).toBeUndefined();
    expect(counts[b]).toBe(2);
    const audit = await asOwner((c) =>
      c.query('SELECT 1 FROM infra.audit_log WHERE account_id = $1', [a]),
    );
    expect(audit.rowCount).toBe(1);
  });

  // 014 T088 (FR-022): xóa tài khoản ⇒ 3 bảng media mất theo FK CASCADE; kho tệp xóa mọi tệp dưới `tenants/{acc}/`
  // (gốc, chuẩn hóa, thu nhỏ, tạm) và hủy phiên nhiều phần đang mở; sau đó không cấp thêm URL nào.
  it('thư viện media: CASCADE xóa 3 bảng, kho tệp sạch tiền tố tài khoản và phiên nhiều phần bị hủy, không cấp thêm URL', async () => {
    const storage = new MemoryObjectStorage();
    const api = new MediaPublicApiImpl(
      loadConfig({ APP_ENV: 'test', DATABASE_APP_URL: dbUrls.app }),
      storage,
    );
    const a = await createAccount();
    const b = await createAccount();
    const user = uuidV7();
    const seedMedia = async (acc: string): Promise<string> => {
      const id = uuidV7();
      await asOwner(async (c) => {
        await c.query(
          `INSERT INTO media.media (id, account_id, kind, status, display_name, original_content_type, original_bytes, uploaded_by_user_id,
              file_hash, width, height, processed_at, normalized_bytes, thumb_bytes)
           VALUES ($1,$2,'image','ready','a.png','image/png',5000,$3,$4,640,480,now(),1200,300)`,
          [id, acc, user, id.replace(/-/g, '').padEnd(64, 'e')],
        );
        await c.query(
          `INSERT INTO media.upload_sessions (id, account_id, media_id, created_by_user_id, fingerprint, mode, declared_bytes,
              declared_content_type, state, expires_at)
           VALUES ($1,$2,$3,$4,$5,'single',5000,'image/png','completed', now() + interval '1 day')`,
          [uuidV7(), acc, id, user, id.replace(/-/g, '').padEnd(64, 'f')],
        );
        await c.query(
          `INSERT INTO media.storage_quotas (id, account_id, used_bytes, limit_bytes) VALUES ($1,$2,5000,5368709120)
           ON CONFLICT (account_id) DO NOTHING`,
          [uuidV7(), acc],
        );
      });
      for (const l of [
        loc.mediaOriginal(id),
        loc.mediaNormalized(id, 'jpeg'),
        loc.mediaThumb(id),
      ]) {
        await withAccount(acc, () =>
          storage.write(l, Buffer.from('x'), { contentType: 'application/octet-stream' }),
        );
      }
      return id;
    };
    const mediaA = await seedMedia(a);
    const mediaB = await seedMedia(b);
    // phiên nhiều phần đang mở của A
    await withAccount(a, () =>
      storage.createMultipart(loc.mediaOriginal(uuidV7()), {
        contentType: 'video/mp4',
        bytes: 9 * 1024 * 1024,
        partSizeBytes: 8 * 1024 * 1024,
      }),
    );
    expect(await withAccount(a, async () => storage.openMultipartCount())).toBe(1);

    await asOwner((c) => c.query('DELETE FROM account.accounts WHERE id = $1', [a]));
    for (const table of ['media', 'upload_sessions', 'storage_quotas']) {
      const counts = await countByAccount(`media.${table}`);
      expect(counts[a], `media.${table} còn dòng của tài khoản đã xóa`).toBeUndefined();
      expect(counts[b], `media.${table} của tài khoản khác bị mất`).toBeGreaterThanOrEqual(1);
    }

    // kho tệp: xóa mọi thứ dưới tiền tố của A, giữ nguyên của B
    const removed = await withAccount(a, () => storage.deleteAllForCurrentAccount());
    expect(removed.deleted).toBeGreaterThanOrEqual(3);
    expect(await withAccount(a, async () => storage.openMultipartCount())).toBe(0);
    for (const l of [
      loc.mediaOriginal(mediaA),
      loc.mediaNormalized(mediaA, 'jpeg'),
      loc.mediaThumb(mediaA),
    ]) {
      expect((await withAccount(a, () => storage.stat(l))).exists).toBe(false);
    }
    expect((await withAccount(b, () => storage.stat(loc.mediaOriginal(mediaB)))).exists).toBe(true);

    // sau khi xóa: không cấp thêm URL nào cho media cũ (dòng đã mất ⇒ not_found / không URL xem trước)
    const previews = await withAccount(a, () => api.getPreviewUrls([mediaA]));
    expect(previews[0]).toMatchObject({ thumbUrl: null, expiresAt: null });
    expect(await withAccount(a, () => api.issuePublicUrl(mediaA))).toEqual({ kind: 'not_found' });
  });
});
