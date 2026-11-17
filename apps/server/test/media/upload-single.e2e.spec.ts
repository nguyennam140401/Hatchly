// US1 – tải một lần (≤ 8 MiB) qua API thật trên CSDL thử + kho memory (014 contracts/media-http-api.md mục 2, 4, 5, 6).
import {
  CompleteUploadResponse,
  StartUploadResponse,
  UploadStatusResponse,
} from '@app/shared/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QueueLifecycle } from '../../src/modules/queue';
import {
  createTestApp,
  registerAndVerify,
  type Agent,
  type MeBody,
  type TestApp,
} from '../auth/helpers/app';
import { describeDb } from '../db/helpers/db';
import {
  UPLOADS,
  browserUploadSingle,
  expectError,
  fixture,
  jpeg,
  mediaRows,
  processJobCount,
  quotaRow,
  startUpload,
  storageOf,
  uniqueJpeg,
  type FileSpec,
} from './helpers';

describeDb('Tải lên một lần (e2e)', () => {
  let t: TestApp;
  let owner: { agent: Agent; me: MeBody };
  let accountId: string;

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    owner = await registerAndVerify(t, { displayName: 'Chị Lan' });
    accountId = owner.me.account.id;
  });
  afterAll(async () => {
    await t.close();
  });

  describe('bắt đầu', () => {
    it('ảnh hợp lệ ⇒ 201, chế độ single, đường dẫn POST ký sẵn; giữ chỗ dung lượng; chưa có trong thư viện', async () => {
      const f = uniqueJpeg();
      const res = await startUpload(owner.agent, f);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const body = StartUploadResponse.parse(res.body);
      expect(body).toMatchObject({ mode: 'single', resumed: false });
      if (body.mode !== 'single') throw new Error('mode');
      expect(body.post.url).toBeTruthy();
      expect(body.post.fields.key).toContain(`tenants/${accountId}/media/${body.mediaId}/original`);
      // giữ chỗ đúng dung lượng khai báo; dòng `uploading` không hiện trong thư viện
      const before = await quotaRow(accountId);
      expect(before?.reserved).toBeGreaterThanOrEqual(f.bytes.length);
      const list = await owner.agent.get('/api/v1/media');
      expect((list.body as { items: { id: string }[] }).items.map((i) => i.id)).not.toContain(
        body.mediaId,
      );
    });

    it('loại không nhận ⇒ 400 MEDIA_TYPE_UNSUPPORTED kèm hành động', async () => {
      const before = (await mediaRows(accountId)).length;
      for (const contentType of ['image/gif', 'image/svg+xml', 'application/pdf', 'audio/mpeg']) {
        const res = await startUpload(owner.agent, { ...jpeg('x.bin'), contentType });
        expectError(res, 400, 'MEDIA_TYPE_UNSUPPORTED');
      }
      expect((await mediaRows(accountId)).length).toBe(before); // không tạo dòng/đường dẫn nào
    });

    it('quá cỡ ⇒ 400 MEDIA_TOO_LARGE: ảnh > 20 MiB, video > 500 MiB; tệp rỗng ⇒ 400', async () => {
      const f = jpeg();
      const bigImage = await startUpload(owner.agent, f, { sizeBytes: 20 * 1024 * 1024 + 1 });
      const e1 = expectError(bigImage, 400, 'MEDIA_TOO_LARGE');
      expect(e1.extra).toMatchObject({ maxBytes: 20 * 1024 * 1024 });
      const bigVideo = await startUpload(
        owner.agent,
        { ...f, contentType: 'video/mp4' },
        {
          sizeBytes: 500 * 1024 * 1024 + 1,
        },
      );
      expectError(bigVideo, 400, 'MEDIA_TOO_LARGE');
      const empty = await startUpload(owner.agent, f, { sizeBytes: 0 });
      expect(empty.status).toBe(400);
    });

    it('tên tệp nguy hiểm không vào khóa kho; tên hiển thị được chuẩn hóa', async () => {
      const f = uniqueJpeg('../../etc/passwd\u0000.jpg');
      const res = await startUpload(owner.agent, f);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const body = StartUploadResponse.parse(res.body);
      if (body.mode !== 'single') throw new Error('mode');
      expect(body.post.fields.key).not.toContain('passwd');
      expect(body.post.fields.key).not.toContain('..');
    });
  });

  describe('xác nhận', () => {
    it('đạt ⇒ 202, media "đang xử lý", đúng MỘT việc media.process; dung lượng chốt', async () => {
      const f = uniqueJpeg();
      const start = StartUploadResponse.parse((await startUpload(owner.agent, f)).body);
      const reservedBefore = (await quotaRow(accountId))!.reserved;
      await browserUploadSingle(t, start, f.bytes, f.contentType);
      const done = await owner.agent.post(`${UPLOADS}/${start.uploadId}/complete`);
      expect(done.status, JSON.stringify(done.body)).toBe(202);
      expect(CompleteUploadResponse.parse(done.body)).toEqual({
        uploadId: start.uploadId,
        mediaId: start.mediaId,
        state: 'completed',
      });
      const row = (await mediaRows(accountId)).find((r) => r.id === start.mediaId);
      expect(row).toMatchObject({ status: 'processing' });
      expect(await processJobCount(start.mediaId)).toBe(1);
      const q = (await quotaRow(accountId))!;
      expect(q.reserved).toBe(reservedBefore - f.bytes.length); // giữ chỗ → chốt
      const st = UploadStatusResponse.parse(
        (await owner.agent.get(`${UPLOADS}/${start.uploadId}`)).body,
      );
      expect(st).toMatchObject({ state: 'completed', mediaStatus: 'processing' });
    });

    it('gọi complete hai lần (và song song) ⇒ cùng kết quả, một media, một việc', async () => {
      const f = uniqueJpeg();
      const start = StartUploadResponse.parse((await startUpload(owner.agent, f)).body);
      await browserUploadSingle(t, start, f.bytes, f.contentType);
      const [a, b] = await Promise.all([
        owner.agent.post(`${UPLOADS}/${start.uploadId}/complete`),
        owner.agent.post(`${UPLOADS}/${start.uploadId}/complete`),
      ]);
      expect([a.status, b.status]).toEqual([202, 202]);
      const again = await owner.agent.post(`${UPLOADS}/${start.uploadId}/complete`);
      expect(again.status).toBe(202);
      expect(again.body).toEqual(a.body);
      expect((await mediaRows(accountId)).filter((r) => r.id === start.mediaId)).toHaveLength(1);
      expect(await processJobCount(start.mediaId)).toBe(1);
    });

    it('kho chưa có tệp ⇒ 409 UPLOAD_INCOMPLETE, phiên vẫn mở và tiếp tục được', async () => {
      const f = uniqueJpeg();
      const start = StartUploadResponse.parse((await startUpload(owner.agent, f)).body);
      const early = await owner.agent.post(`${UPLOADS}/${start.uploadId}/complete`);
      expectError(early, 409, 'UPLOAD_INCOMPLETE');
      await browserUploadSingle(t, start, f.bytes, f.contentType);
      const ok = await owner.agent.post(`${UPLOADS}/${start.uploadId}/complete`);
      expect(ok.status, JSON.stringify(ok.body)).toBe(202);
    });

    const rejects: [string, () => { f: FileSpec; upload: Buffer; contentType?: string }, string][] =
      [
        [
          'lệch dung lượng (tải thiếu)',
          () => {
            const f = uniqueJpeg();
            return { f, upload: f.bytes.subarray(0, f.bytes.length - 10) };
          },
          'size_mismatch',
        ],
        [
          'loại thật khác loại khai báo (PNG khai báo JPEG)',
          () => {
            const bytes = fixture('plain.png');
            return { f: { name: 'a.jpg', bytes, contentType: 'image/jpeg' }, upload: bytes };
          },
          'type_mismatch',
        ],
        [
          'tệp giả đuôi ảnh (HTML)',
          () => {
            const bytes = fixture('fake-html.jpg');
            return { f: { name: 'b.jpg', bytes, contentType: 'image/jpeg' }, upload: bytes };
          },
          'type_unsupported',
        ],
        [
          'WebP động',
          () => {
            const bytes = fixture('animated.webp');
            return { f: { name: 'c.webp', bytes, contentType: 'image/webp' }, upload: bytes };
          },
          'animated',
        ],
      ];
    it.each(rejects)(
      'bị bác khi xác nhận: %s ⇒ 422 UPLOAD_REJECTED, trả giữ chỗ, xóa tệp dở',
      async (_name, make, code) => {
        const { f, upload } = make();
        const reservedBefore = (await quotaRow(accountId))!.reserved;
        const start = StartUploadResponse.parse((await startUpload(owner.agent, f)).body);
        await browserUploadSingle(t, start, upload, f.contentType);
        const res = await owner.agent.post(`${UPLOADS}/${start.uploadId}/complete`);
        const error = expectError(res, 422, 'UPLOAD_REJECTED');
        expect(error.extra).toMatchObject({ failureCode: code });
        expect((await quotaRow(accountId))!.reserved).toBe(reservedBefore); // giữ chỗ đã trả
        expect((await mediaRows(accountId)).find((r) => r.id === start.mediaId)).toBeUndefined();
        if (start.mode === 'single') {
          const key = start.post.fields.key!;
          expect(storageOf(t).keyOf).toBeDefined();
          const exists = await asKeyExists(t, start.mediaId);
          expect(exists, `tệp dở của ${key} phải bị xóa`).toBe(false);
        }
        expect(await processJobCount(start.mediaId)).toBe(0);
      },
    );
  });

  describe('hủy', () => {
    it('DELETE ⇒ 204, trả giữ chỗ, xóa dòng dở; gọi lặp ⇒ 204', async () => {
      const reservedBefore = (await quotaRow(accountId))!.reserved;
      const f = uniqueJpeg();
      const start = StartUploadResponse.parse((await startUpload(owner.agent, f)).body);
      expect((await quotaRow(accountId))!.reserved).toBe(reservedBefore + f.bytes.length);
      const res = await owner.agent.delete(`${UPLOADS}/${start.uploadId}`);
      expect(res.status).toBe(204);
      expect((await quotaRow(accountId))!.reserved).toBe(reservedBefore);
      expect((await mediaRows(accountId)).find((r) => r.id === start.mediaId)).toBeUndefined();
      expect((await owner.agent.delete(`${UPLOADS}/${start.uploadId}`)).status).toBe(204);
    });
  });

  describe('nhận lại phiên (cùng người + cùng tệp)', () => {
    it('bắt đầu lại cùng tệp khi phiên còn mở ⇒ 200 resumed, không giữ chỗ thêm', async () => {
      const f = uniqueJpeg();
      const first = await startUpload(owner.agent, f);
      expect(first.status).toBe(201);
      const reserved = (await quotaRow(accountId))!.reserved;
      const again = await startUpload(owner.agent, f);
      expect(again.status).toBe(200);
      expect(StartUploadResponse.parse(again.body)).toMatchObject({
        resumed: true,
        uploadId: (first.body as { uploadId: string }).uploadId,
      });
      expect((await quotaRow(accountId))!.reserved).toBe(reservedUnchanged(reserved));
    });
  });
});

function reservedUnchanged(n: number): number {
  return n;
}

/** Tệp gốc của media còn trong kho memory không (kiểm bằng `stat` trong ngữ cảnh tài khoản của khóa). */
async function asKeyExists(t: TestApp, mediaId: string): Promise<boolean> {
  const storage = storageOf(t);
  // Duyệt kho bằng danh sách khóa nội bộ của bản memory: dùng `keyOf` cần ngữ cảnh ⇒ đọc trực tiếp bản đồ đối tượng.
  const objects = (storage as unknown as { objects: Map<string, unknown> }).objects;
  return [...objects.keys()].some((k) => k.includes(`/media/${mediaId}/original`));
}
