// Cô lập + ràng buộc của schema `media` (014 T021, hiến pháp I, FR-018, FR-020, SC-005).
// Truy cập chéo A↔B (đọc/sửa/xóa/chèn) cho 3 bảng chạy tự động ở `cross-tenant-coverage.db.spec.ts` nhờ fixture;
// ở đây kiểm thêm: không ngữ cảnh → 0 dòng, từng CHECK/chỉ mục duy nhất, hàm quét dọn `SECURITY DEFINER`.
import { Client } from 'pg';
import { describe, expect, it, beforeAll } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { asOwner, createAccount, dbUrls, describeDb, rawAppPool } from './helpers/db';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

interface MediaOverrides {
  kind?: string;
  status?: string;
  hash?: string | null;
  width?: number | null;
  height?: number | null;
  processedAt?: string | null;
  normalized?: number | null;
  thumb?: number | null;
  duration?: number | null;
  failureCode?: string | null;
  deletedAt?: string | null;
  displayName?: string;
  bytes?: number;
}

/** Chèn một dòng media bằng owner (không bị RLS); lỗi CHECK/chỉ mục sẽ ném. */
async function insertMedia(accountId: string, o: MediaOverrides = {}): Promise<string> {
  const id = uuidV7();
  await asOwner((c) =>
    c.query(
      `INSERT INTO media.media
         (id, account_id, kind, status, display_name, original_content_type, original_bytes, uploaded_by_user_id,
          file_hash, width, height, processed_at, normalized_bytes, thumb_bytes, duration_ms, failure_code, deleted_at)
       VALUES ($1,$2,$3,$4,$5,'image/jpeg',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id,
        accountId,
        o.kind ?? 'image',
        o.status ?? 'uploading',
        o.displayName ?? 'a.jpg',
        o.bytes ?? 1000,
        uuidV7(),
        o.hash ?? null,
        o.width ?? null,
        o.height ?? null,
        o.processedAt ?? null,
        o.normalized ?? null,
        o.thumb ?? null,
        o.duration ?? null,
        o.failureCode ?? null,
        o.deletedAt ?? null,
      ],
    ),
  );
  return id;
}

const READY = {
  status: 'ready',
  hash: HASH_A,
  width: 100,
  height: 80,
  processedAt: '2026-01-01T00:00:00Z',
  normalized: 500,
  thumb: 50,
};

async function insertSession(
  accountId: string,
  mediaId: string,
  userId: string,
  o: {
    fingerprint?: string;
    state?: string;
    mode?: string;
    partCount?: number | null;
    uploadId?: string | null;
  } = {},
): Promise<void> {
  await asOwner((c) =>
    c.query(
      `INSERT INTO media.upload_sessions
         (id, account_id, media_id, created_by_user_id, fingerprint, mode, declared_bytes, declared_content_type,
          state, part_size_bytes, part_count, multipart_upload_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,1000,'image/jpeg',$7,$8,$9,$10, now() + interval '1 day')`,
      [
        uuidV7(),
        accountId,
        mediaId,
        userId,
        o.fingerprint ?? 'c'.repeat(64),
        o.mode ?? 'single',
        o.state ?? 'open',
        o.mode === 'multipart' ? 8_388_608 : null,
        o.partCount ?? null,
        o.uploadId ?? null,
      ],
    ),
  );
}

describeDb('Schema media – cô lập và ràng buộc', () => {
  let a: string;
  let b: string;

  beforeAll(async () => {
    a = await createAccount();
    b = await createAccount();
  });

  it('vai trò app không đặt ngữ cảnh tenant → 0 dòng ở cả ba bảng', async () => {
    const m = await insertMedia(a);
    await asOwner((c) =>
      c.query(
        `INSERT INTO media.storage_quotas (id, account_id, limit_bytes) VALUES ($1, $2, 5368709120)`,
        [uuidV7(), a],
      ),
    );
    await insertSession(a, m, uuidV7());
    const pool = rawAppPool();
    try {
      for (const table of ['media.media', 'media.upload_sessions', 'media.storage_quotas']) {
        const r = await pool.query(`SELECT * FROM ${table}`);
        expect(r.rowCount, table).toBe(0);
      }
    } finally {
      await pool.end();
    }
  });

  describe('CHECK của media.media', () => {
    it('loại / trạng thái / tên / dung lượng / dấu tệp sai bị từ chối', async () => {
      await expect(insertMedia(a, { kind: 'audio' })).rejects.toThrow(/media_kind_check/);
      await expect(insertMedia(a, { status: 'weird' })).rejects.toThrow(/media_status_check/);
      await expect(insertMedia(a, { displayName: '' })).rejects.toThrow(
        /media_display_name_length/,
      );
      await expect(insertMedia(a, { displayName: 'x'.repeat(256) })).rejects.toThrow(
        /media_display_name_length/,
      );
      await expect(insertMedia(a, { bytes: 0 })).rejects.toThrow(/media_original_bytes_positive/);
      await expect(insertMedia(a, { hash: 'XYZ'.padEnd(64, '0') })).rejects.toThrow(
        /media_file_hash_format/,
      );
    });

    it('thời lượng chỉ cho video', async () => {
      await expect(insertMedia(a, { kind: 'image', duration: 1000 })).rejects.toThrow(
        /media_duration_video_only/,
      );
      await expect(
        insertMedia(a, { ...READY, kind: 'video', hash: HASH_B, normalized: null, duration: 1000 }),
      ).resolves.toBeTruthy();
    });

    it('ready phải đủ dấu tệp, kích thước, bản chuẩn hóa (ảnh), ảnh thu nhỏ', async () => {
      await expect(insertMedia(a, { ...READY, hash: null })).rejects.toThrow(
        /media_ready_complete/,
      );
      await expect(insertMedia(a, { ...READY, width: null })).rejects.toThrow(
        /media_ready_complete/,
      );
      await expect(insertMedia(a, { ...READY, processedAt: null })).rejects.toThrow(
        /media_ready_complete/,
      );
      await expect(insertMedia(a, { ...READY, normalized: null })).rejects.toThrow(
        /media_ready_image_normalized/,
      );
      await expect(insertMedia(a, { ...READY, thumb: null })).rejects.toThrow(/media_ready_thumb/);
    });

    it('unprocessable phải có failure_code', async () => {
      await expect(insertMedia(a, { status: 'unprocessable' })).rejects.toThrow(
        /media_unprocessable_failure_code/,
      );
      await expect(
        insertMedia(a, { status: 'unprocessable', failureCode: 'corrupt' }),
      ).resolves.toBeTruthy();
    });
  });

  describe('chống trùng nội dung (R3, FR-020)', () => {
    it('cùng tài khoản + cùng dấu tệp ⇒ vi phạm chỉ mục duy nhất; tài khoản khác thì được', async () => {
      const h = 'd'.repeat(64);
      await insertMedia(a, { ...READY, hash: h });
      await expect(insertMedia(a, { ...READY, hash: h })).rejects.toThrow(
        /media_account_file_hash_key/,
      );
      await expect(insertMedia(a, { status: 'processing', hash: h })).rejects.toThrow(
        /media_account_file_hash_key/,
      );
      await expect(insertMedia(b, { ...READY, hash: h })).resolves.toBeTruthy(); // bản riêng, không tiết lộ nhau
    });

    it('tệp đã xóa mềm và tệp "không xử lý được" không chiếm dấu', async () => {
      const h = 'e'.repeat(64);
      await insertMedia(a, { ...READY, hash: h, deletedAt: '2026-01-02T00:00:00Z' });
      await insertMedia(a, { status: 'unprocessable', hash: h, failureCode: 'corrupt' });
      await expect(insertMedia(a, { ...READY, hash: h })).resolves.toBeTruthy();
    });
  });

  describe('media.upload_sessions', () => {
    it('một phiên đang hoạt động cho mỗi (người, tệp); phiên đã đóng không chặn', async () => {
      const m = await insertMedia(a);
      const user = uuidV7();
      const fp = 'f'.repeat(64);
      await insertSession(a, m, user, { fingerprint: fp, state: 'open' });
      await expect(
        insertSession(a, m, user, { fingerprint: fp, state: 'completing' }),
      ).rejects.toThrow(/upload_sessions_active_fingerprint_key/);
      await insertSession(a, m, user, { fingerprint: fp, state: 'expired' }); // đã đóng ⇒ được
      await insertSession(a, m, uuidV7(), { fingerprint: fp, state: 'open' }); // người khác ⇒ được
    });

    it('CHECK: trạng thái, chế độ, hình dạng multipart, dấu vân tay', async () => {
      const m = await insertMedia(a);
      await expect(insertSession(a, m, uuidV7(), { state: 'bogus' })).rejects.toThrow(
        /upload_sessions_state_check/,
      );
      await expect(insertSession(a, m, uuidV7(), { mode: 'chunked' })).rejects.toThrow(
        /upload_sessions_mode_check/,
      );
      await expect(insertSession(a, m, uuidV7(), { fingerprint: 'abc' })).rejects.toThrow(
        /upload_sessions_fingerprint_format/,
      );
      // multipart thiếu part_count
      await expect(
        insertSession(a, m, uuidV7(), { mode: 'multipart', partCount: null }),
      ).rejects.toThrow(/upload_sessions_multipart_shape/);
      // single không được có uploadId
      await expect(
        insertSession(a, m, uuidV7(), { mode: 'single', uploadId: 'xyz' }),
      ).rejects.toThrow(/upload_sessions_multipart_shape/);
      await expect(
        insertSession(a, m, uuidV7(), {
          mode: 'multipart',
          partCount: 3,
          uploadId: 'u1',
          fingerprint: '1'.repeat(64),
        }),
      ).resolves.toBeUndefined();
    });

    it('xóa media ⇒ phiên tải của nó bị xóa theo (FK nội bộ CASCADE)', async () => {
      const m = await insertMedia(a);
      await insertSession(a, m, uuidV7(), { fingerprint: '2'.repeat(64) });
      await asOwner((c) => c.query('DELETE FROM media.media WHERE id = $1', [m]));
      const left = await asOwner((c) =>
        c.query('SELECT 1 FROM media.upload_sessions WHERE media_id = $1', [m]),
      );
      expect(left.rowCount).toBe(0);
    });
  });

  describe('media.storage_quotas', () => {
    it('một dòng mỗi tài khoản; CHECK used + reserved ≤ limit là chốt chặn cuối (SC-005)', async () => {
      const acc = await createAccount();
      const insert = (used: number, reserved: number, limit: number) =>
        asOwner((c) =>
          c.query(
            'INSERT INTO media.storage_quotas (id, account_id, used_bytes, reserved_bytes, limit_bytes) VALUES ($1,$2,$3,$4,$5)',
            [uuidV7(), acc, used, reserved, limit],
          ),
        );
      await expect(insert(-1, 0, 100)).rejects.toThrow(/storage_quotas_within_limit/);
      await expect(insert(0, -1, 100)).rejects.toThrow(/storage_quotas_within_limit/);
      await expect(insert(60, 41, 100)).rejects.toThrow(/storage_quotas_within_limit/);
      await expect(insert(0, 0, 0)).rejects.toThrow(/storage_quotas_limit_positive/);
      await insert(60, 40, 100);
      await expect(insert(0, 0, 100)).rejects.toThrow(/storage_quotas_account_id_key/);
      // cập nhật làm vượt trần cũng bị chặn
      await expect(
        asOwner((c) =>
          c.query(
            'UPDATE media.storage_quotas SET reserved_bytes = reserved_bytes + 1 WHERE account_id = $1',
            [acc],
          ),
        ),
      ).rejects.toThrow(/storage_quotas_within_limit/);
    });
  });

  describe('media.list_cleanup_accounts (SECURITY DEFINER, R7)', () => {
    async function callAs(url: string, sql: string, params: unknown[]) {
      const client = new Client({ connectionString: url });
      await client.connect();
      try {
        return await client.query(sql, params);
      } finally {
        await client.end();
      }
    }
    const call = (kind: string): [string, unknown[]] => [
      "SELECT * FROM media.list_cleanup_accounts($1, now() + interval '1 day', 100)",
      [kind],
    ];

    it('system: chỉ trả mã tài khoản (một cột uuid), đúng tài khoản có việc cần dọn', async () => {
      const acc = await createAccount();
      const m = await insertMedia(acc);
      // phiên đã quá hạn
      await asOwner((c) =>
        c.query(
          `INSERT INTO media.upload_sessions (id, account_id, media_id, created_by_user_id, fingerprint, mode,
             declared_bytes, declared_content_type, state, expires_at)
           VALUES ($1,$2,$3,$4,$5,'single',1000,'image/jpeg','open', now() - interval '1 hour')`,
          [uuidV7(), acc, m, uuidV7(), '9'.repeat(64)],
        ),
      );
      const stale = await callAs(dbUrls.system, ...call('stale_sessions'));
      expect(stale.fields.map((f) => f.name)).toEqual(['list_cleanup_accounts']);
      expect(
        stale.rows.map((r: { list_cleanup_accounts: string }) => r.list_cleanup_accounts),
      ).toContain(acc);

      // media xóa mềm chưa xóa tệp
      const acc2 = await createAccount();
      await insertMedia(acc2, {
        ...READY,
        hash: '7'.repeat(64),
        deletedAt: '2026-01-01T00:00:00Z',
      });
      const purge = await callAs(dbUrls.system, ...call('pending_purge'));
      const ids = purge.rows.map((r: { list_cleanup_accounts: string }) => r.list_cleanup_accounts);
      expect(ids).toContain(acc2);
      expect(ids).not.toContain(a === acc2 ? '' : b); // b không có media xóa mềm chưa purge

      const full = await callAs(dbUrls.system, ...call('full'));
      expect(
        full.rows.map((r: { list_cleanup_accounts: string }) => r.list_cleanup_accounts),
      ).toContain(acc);
    });

    it('kind sai / lim sai ⇒ lỗi', async () => {
      await expect(
        callAs(dbUrls.system, "SELECT * FROM media.list_cleanup_accounts('weird', now(), 10)", []),
      ).rejects.toThrow();
      await expect(
        callAs(dbUrls.system, "SELECT * FROM media.list_cleanup_accounts('full', now(), 0)", []),
      ).rejects.toThrow();
    });

    it('vai trò khác `system` (app, support) bị từ chối', async () => {
      for (const url of [dbUrls.app, dbUrls.support]) {
        await expect(callAs(url, ...call('full'))).rejects.toThrow(/permission denied/i);
      }
    });
  });

  it('describe sanity: bảng media đã có RLS bật', async () => {
    const r = await asOwner((c) =>
      c.query(
        `SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'media' AND relkind = 'r' ORDER BY 1`,
      ),
    );
    expect(r.rows).toEqual([
      { relname: 'media', relrowsecurity: true },
      { relname: 'storage_quotas', relrowsecurity: true },
      { relname: 'upload_sessions', relrowsecurity: true },
    ]);
  });
});
