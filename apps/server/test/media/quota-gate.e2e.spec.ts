// US4 – giới hạn 5 GB: chặn TRƯỚC khi tải byte nào, không vượt trần dù đồng thời, gói hết hạn chỉ chặn tải (014 T062,
// contracts/media-http-api.md mục 1–2, FR-008/010/018, SC-005).
import { Quota, StartUploadResponse } from '@app/shared/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QueueLifecycle } from '../../src/modules/queue';
import { UPLOAD_GATE, type UploadGate } from '../../src/modules/media/internal/upload-gate';
import {
  createTestApp,
  registerAndVerify,
  type Agent,
  type MeBody,
  type TestApp,
} from '../auth/helpers/app';
import { asOwner, describeDb } from '../db/helpers/db';
import {
  MEDIA,
  UPLOADS,
  expectError,
  jpeg,
  mediaRows,
  quotaRow,
  startUpload,
  uniqueJpeg,
} from './helpers';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

describeDb('Giới hạn dung lượng (e2e)', () => {
  let t: TestApp;
  let owner: { agent: Agent; me: MeBody };
  let accountId: string;
  let seq = 0;

  const setQuota = (used: number, reserved = 0) =>
    asOwner((c) =>
      c.query(
        `INSERT INTO media.storage_quotas (id, account_id, used_bytes, reserved_bytes, limit_bytes)
         VALUES (gen_random_uuid(), $1, $2, $3, 5368709120)
         ON CONFLICT (account_id) DO UPDATE SET used_bytes = $2, reserved_bytes = $3`,
        [accountId, used, reserved],
      ),
    );

  /** POST /media/uploads cho một video khai báo `size` byte, mỗi lần khác dấu vân tay. */
  const startVideo = (size: number) => {
    seq += 1;
    return owner.agent.post(UPLOADS, {
      fileName: `v${String(seq)}.mp4`,
      sizeBytes: size,
      contentType: 'video/mp4',
      fingerprint: seq.toString(16).padStart(64, '0'),
    });
  };

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    owner = await registerAndVerify(t, { displayName: 'Chị Lan' });
    accountId = owner.me.account.id;
  });
  afterAll(async () => {
    await t.close();
  });

  it('GET /media/quota: chưa có dòng ⇒ 0/0/5 GiB, percent 0, state ok', async () => {
    const res = await owner.agent.get(`${MEDIA}/quota`);
    expect(res.status).toBe(200);
    expect(Quota.parse(res.body)).toEqual({
      usedBytes: 0,
      reservedBytes: 0,
      limitBytes: 5 * GIB,
      percent: 0,
      state: 'ok',
    });
  });

  it('percent/state theo ngưỡng: 79% ok · 80% near_full · đủ trần full (đọc thẳng CSDL, không cache)', async () => {
    const limit = 5 * GIB;
    await setQuota(Math.ceil(limit * 0.79));
    expect((await owner.agent.get(`${MEDIA}/quota`)).body).toMatchObject({
      percent: 79,
      state: 'ok',
    });
    await setQuota(Math.floor(limit * 0.8) + 1);
    expect((await owner.agent.get(`${MEDIA}/quota`)).body).toMatchObject({
      percent: 80,
      state: 'near_full',
    });
    await setQuota(limit - 1);
    expect((await owner.agent.get(`${MEDIA}/quota`)).body).toMatchObject({
      percent: 99,
      state: 'near_full',
    });
    await setQuota(limit - 10 * MIB, 10 * MIB);
    expect((await owner.agent.get(`${MEDIA}/quota`)).body).toMatchObject({
      percent: 100,
      state: 'full',
    });
    // thay đổi bộ đếm thấy NGAY (không cache): giải phóng ⇒ về ok
    await setQuota(0);
    expect((await owner.agent.get(`${MEDIA}/quota`)).body).toMatchObject({ state: 'ok' });
  });

  it('hết chỗ ⇒ 409 MEDIA_QUOTA_EXCEEDED ngay lúc bắt đầu: KHÔNG tạo media/phiên/đường dẫn tải', async () => {
    await setQuota(Math.floor(4.9 * GIB));
    const before = (await mediaRows(accountId)).length;
    const sessionsBefore = await asOwner(
      async (c) =>
        (
          await c.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM media.upload_sessions WHERE account_id = $1',
            [accountId],
          )
        ).rows[0]?.n ?? 0,
    );
    const res = await startVideo(300 * MIB);
    const error = expectError(res, 409, 'MEDIA_QUOTA_EXCEEDED');
    expect(error.message).toMatch(
      /Thư viện đã đầy \(4,9\/5 GB\)\. Hãy xóa bớt ảnh\/video cũ rồi tải lại\./,
    );
    expect(error.actions[0]).toMatchObject({ kind: 'navigate', label: 'Xem danh sách để xóa' });
    expect(Quota.parse((error.extra as { quota: unknown }).quota)).toMatchObject({
      limitBytes: 5 * GIB,
    });
    expect(res.body).not.toHaveProperty('post');
    expect((await mediaRows(accountId)).length).toBe(before);
    const sessionsAfter = await asOwner(
      async (c) =>
        (
          await c.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM media.upload_sessions WHERE account_id = $1',
            [accountId],
          )
        ).rows[0]?.n ?? 0,
    );
    expect(sessionsAfter).toBe(sessionsBefore);
    expect((await quotaRow(accountId))!.reserved).toBe(0); // không giữ chỗ
  });

  it('SC-005: 24 yêu cầu bắt đầu SONG SONG khi chỉ còn 512 MiB ⇒ đúng 5 yêu cầu 100 MiB thành công, không vượt trần', async () => {
    await setQuota(Math.floor(4.5 * GIB)); // còn 512 MiB
    const results = await Promise.all(Array.from({ length: 24 }, () => startVideo(100 * MIB)));
    const ok = results.filter((r) => r.status === 201);
    const full = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(5);
    expect(full).toHaveLength(19);
    for (const r of full)
      expect((r.body as { error: { code: string } }).error.code).toBe('MEDIA_QUOTA_EXCEEDED');
    const q = (await quotaRow(accountId))!;
    expect(q.reserved).toBe(5 * 100 * MIB);
    expect(q.used + q.reserved).toBeLessThanOrEqual(5 * GIB);
    // dọn: hủy các phiên đã mở để các ca sau có chỗ
    for (const r of ok) {
      expect(
        (await owner.agent.delete(`${UPLOADS}/${StartUploadResponse.parse(r.body).uploadId}`))
          .status,
      ).toBe(204);
    }
    expect((await quotaRow(accountId))!.reserved).toBe(0);
  });

  describe('gói hết hạn chỉ chặn TẢI LÊN (FR-018, nguyên tắc VI: không chặn khi không cần)', () => {
    const gate = (): UploadGate => t.app.get<UploadGate>(UPLOAD_GATE);
    let original: UploadGate['canUpload'];

    beforeAll(() => {
      original = gate().canUpload.bind(gate());
    });
    afterAll(() => {
      gate().canUpload = original;
    });

    it('gói hết hạn ⇒ 403 MEDIA_PLAN_EXPIRED nhưng xem danh sách, xem dung lượng, hủy phiên đang mở vẫn dùng được', async () => {
      await setQuota(0);
      const open = StartUploadResponse.parse((await startUpload(owner.agent, uniqueJpeg())).body);
      gate().canUpload = () => Promise.resolve({ allowed: false, reason: 'plan_expired' });
      const res = await startUpload(owner.agent, jpeg('moi.jpg'));
      const error = expectError(res, 403, 'MEDIA_PLAN_EXPIRED');
      expect(error.message).toContain('Bạn vẫn xem và xóa được');
      expect(error.actions[0]).toMatchObject({ kind: 'navigate', label: 'Gia hạn gói' });
      expect((await owner.agent.get(MEDIA)).status).toBe(200);
      expect((await owner.agent.get(`${MEDIA}/quota`)).status).toBe(200);
      expect((await owner.agent.delete(`${UPLOADS}/${open.uploadId}`)).status).toBe(204);
      gate().canUpload = original;
      expect((await startUpload(owner.agent, uniqueJpeg())).status).toBe(201); // hết chặn khi gia hạn
    });
  });
});
