// US2 – tải nhiều phần, tiếp tục khi gián đoạn (014 contracts/media-http-api.md mục 2–4, FR-004/005/006/009).
import { CompleteUploadResponse, PartUrlsResponse, StartUploadResponse } from '@app/shared/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QueueLifecycle } from '../../src/modules/queue';
import {
  createTestApp,
  registerAndVerify,
  type Agent,
  type MeBody,
  type TestApp,
} from '../auth/helpers/app';
import { asOwner, describeDb, withAccount } from '../db/helpers/db';
import {
  UPLOADS,
  expectError,
  fixture,
  mediaRows,
  processJobCount,
  quotaRow,
  startBody,
  startUpload,
  storageOf,
  type FileSpec,
} from './helpers';

const MIB = 1024 * 1024;

/** Video hợp lệ (đầu tệp MP4 thật) đệm tới `size` byte – đủ lớn để chia nhiều phần 8 MiB. */
function bigVideo(name: string, size: number): FileSpec {
  const head = fixture('moov-end.mp4');
  const bytes = Buffer.alloc(size);
  head.copy(bytes);
  return { name, bytes, contentType: 'video/mp4' };
}

describeDb('Tải nhiều phần (e2e)', () => {
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

  const parts = (f: FileSpec) => [f.bytes.subarray(0, 8 * MIB), f.bytes.subarray(8 * MIB)];

  async function putPart(uploadId: string, partNumber: number, bytes: Buffer): Promise<void> {
    const res = await owner.agent.post(`${UPLOADS}/${uploadId}/part-urls`, {
      partNumbers: [partNumber],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [signed] = PartUrlsResponse.parse(res.body).parts;
    expect(signed!.contentLength).toBe(bytes.length);
    await storageOf(t).simulateBrowserUploadPart(signed!.url, bytes);
  }

  it('chọn chế độ theo dung lượng: ≤ 8 MiB ⇒ single; lớn hơn ⇒ multipart với partCount = ceil(cỡ / 8 MiB)', async () => {
    const small = bigVideo('nho.mp4', 8 * MIB);
    const s = StartUploadResponse.parse((await startUpload(owner.agent, small)).body);
    expect(s.mode).toBe('single');

    const big = bigVideo('lon.mp4', 9 * MIB);
    const res = await startUpload(owner.agent, big);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(StartUploadResponse.parse(res.body)).toMatchObject({
      mode: 'multipart',
      partSizeBytes: 8 * MIB,
      partCount: 2,
      completedParts: [],
      resumed: false,
    });
  });

  it('part-urls: 1–20 phần, URL hết hạn ≤ 15 phút, phần đã lên vẫn cấp URL mới; số phần sai ⇒ 400', async () => {
    const f = bigVideo('p.mp4', 9 * MIB);
    const start = StartUploadResponse.parse((await startUpload(owner.agent, f)).body);
    const res = await owner.agent.post(`${UPLOADS}/${start.uploadId}/part-urls`, {
      partNumbers: [1, 2],
    });
    const { parts: urls } = PartUrlsResponse.parse(res.body);
    expect(urls.map((p) => p.partNumber)).toEqual([1, 2]);
    expect(urls.map((p) => p.contentLength)).toEqual([8 * MIB, MIB]);
    for (const u of urls) {
      expect(new Date(u.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 2000);
    }
    // phần đã lên vẫn xin lại được
    await storageOf(t).simulateBrowserUploadPart(urls[0]!.url, parts(f)[0]!);
    const again = await owner.agent.post(`${UPLOADS}/${start.uploadId}/part-urls`, {
      partNumbers: [1],
    });
    expect(again.status).toBe(200);
    // số phần ngoài khoảng / rỗng / quá 20
    expect(
      (await owner.agent.post(`${UPLOADS}/${start.uploadId}/part-urls`, { partNumbers: [3] }))
        .status,
    ).toBe(400);
    expect(
      (await owner.agent.post(`${UPLOADS}/${start.uploadId}/part-urls`, { partNumbers: [] }))
        .status,
    ).toBe(400);
  });

  it('tải 1/2 phần ⇒ mở lại cùng tệp ⇒ 200 resumed + completedParts đúng; complete thiếu phần ⇒ 409, phiên vẫn mở; bù phần rồi ghép được', async () => {
    const f = bigVideo('tiep-tuc.mp4', 9 * MIB);
    const first = StartUploadResponse.parse((await startUpload(owner.agent, f)).body);
    const reservedAfterStart = (await quotaRow(accountId))!.reserved;
    await putPart(first.uploadId, 1, parts(f)[0]!);

    // "đóng tab rồi chọn lại đúng tệp": cùng fingerprint ⇒ nhận lại phiên, KHÔNG giữ chỗ thêm
    const again = await startUpload(owner.agent, f);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(StartUploadResponse.parse(again.body)).toMatchObject({
      uploadId: first.uploadId,
      resumed: true,
      mode: 'multipart',
      completedParts: [1],
    });
    expect((await quotaRow(accountId))!.reserved).toBe(reservedAfterStart);

    // thiếu phần 2 ⇒ 409 UPLOAD_INCOMPLETE, phiên vẫn mở
    const early = await owner.agent.post(`${UPLOADS}/${first.uploadId}/complete`);
    expectError(early, 409, 'UPLOAD_INCOMPLETE');
    const status = await owner.agent.get(`${UPLOADS}/${first.uploadId}`);
    expect(status.body).toMatchObject({ state: 'open', completedParts: [1] });

    // bù phần 2 rồi ghép
    await putPart(first.uploadId, 2, parts(f)[1]!);
    const done = await owner.agent.post(`${UPLOADS}/${first.uploadId}/complete`);
    expect(done.status, JSON.stringify(done.body)).toBe(202);
    expect(CompleteUploadResponse.parse(done.body).state).toBe('completed');
    const row = (await mediaRows(accountId)).find((r) => r.id === first.mediaId);
    expect(row).toMatchObject({ status: 'processing' });
  });

  it('hai complete liên tiếp ⇒ một media, một việc media.process', async () => {
    const f = bigVideo('hai-lan.mp4', 9 * MIB);
    const start = StartUploadResponse.parse((await startUpload(owner.agent, f)).body);
    await putPart(start.uploadId, 1, parts(f)[0]!);
    await putPart(start.uploadId, 2, parts(f)[1]!);
    const [a, b] = await Promise.all([
      owner.agent.post(`${UPLOADS}/${start.uploadId}/complete`),
      owner.agent.post(`${UPLOADS}/${start.uploadId}/complete`),
    ]);
    expect([a.status, b.status]).toEqual([202, 202]);
    expect((await mediaRows(accountId)).filter((r) => r.id === start.mediaId)).toHaveLength(1);
    expect(await processJobCount(start.mediaId)).toBe(1);
  });

  it('phiên quá 24 giờ ⇒ chọn lại ⇒ 201 previousExpired, phiên cũ bị dọn, giữ chỗ cũ được trả', async () => {
    const f = bigVideo('het-han.mp4', 9 * MIB);
    const old = StartUploadResponse.parse((await startUpload(owner.agent, f)).body);
    const reservedBefore = (await quotaRow(accountId))!.reserved;
    await asOwner((c) =>
      c.query(
        `UPDATE media.upload_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [old.uploadId],
      ),
    );
    const res = await startUpload(owner.agent, f);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const fresh = StartUploadResponse.parse(res.body);
    expect(fresh).toMatchObject({ previousExpired: true, resumed: false, completedParts: [] });
    expect(fresh.uploadId).not.toBe(old.uploadId);
    expect((await mediaRows(accountId)).find((r) => r.id === old.mediaId)).toBeUndefined();
    // giữ chỗ cũ trả, giữ chỗ mới giữ: tổng không đổi
    expect((await quotaRow(accountId))!.reserved).toBe(reservedBefore);
  });

  it('hủy phiên nhiều phần ⇒ trả giữ chỗ và hủy tải nhiều phần ở kho', async () => {
    const f = bigVideo('huy.mp4', 9 * MIB);
    const reservedBefore = (await quotaRow(accountId))!.reserved;
    const start = StartUploadResponse.parse((await startUpload(owner.agent, f)).body);
    await putPart(start.uploadId, 1, parts(f)[0]!);
    expect((await owner.agent.delete(`${UPLOADS}/${start.uploadId}`)).status).toBe(204);
    expect((await quotaRow(accountId))!.reserved).toBe(reservedBefore);
    // phiên đã đóng ⇒ không cấp thêm URL phần
    const after = await owner.agent.post(`${UPLOADS}/${start.uploadId}/part-urls`, {
      partNumbers: [2],
    });
    expect(after.status).toBe(404);
  });

  it('loại thật không khớp khi ghép ⇒ 422 UPLOAD_REJECTED, giữ chỗ trả, tệp dở bị hủy', async () => {
    // khai báo mp4 nhưng nội dung là ảnh JPEG đệm lớn
    const jpg = fixture('plain.jpg');
    const bytes = Buffer.alloc(9 * MIB);
    jpg.copy(bytes);
    const f: FileSpec = { name: 'gia.mp4', bytes, contentType: 'video/mp4' };
    const reservedBefore = (await quotaRow(accountId))!.reserved;
    const sessionsBefore = await withAccount(accountId, () =>
      Promise.resolve(storageOf(t).openMultipartCount()),
    );
    const start = StartUploadResponse.parse((await owner.agent.post(UPLOADS, startBody(f))).body);
    await putPart(start.uploadId, 1, f.bytes.subarray(0, 8 * MIB));
    await putPart(start.uploadId, 2, f.bytes.subarray(8 * MIB));
    const res = await owner.agent.post(`${UPLOADS}/${start.uploadId}/complete`);
    const error = expectError(res, 422, 'UPLOAD_REJECTED');
    expect(error.extra).toMatchObject({ failureCode: 'type_mismatch' });
    expect((await quotaRow(accountId))!.reserved).toBe(reservedBefore);
    // phiên nhiều phần ở kho đã bị hủy (không để rác tính phí)
    expect(
      await withAccount(accountId, () => Promise.resolve(storageOf(t).openMultipartCount())),
    ).toBe(sessionsBefore);
  });
});
