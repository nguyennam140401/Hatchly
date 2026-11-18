// FR-023 (014 T087): không dòng nhật ký, thông điệp lỗi hay phản hồi lỗi nào chứa URL ký sẵn, trường `post.fields`,
// mã phiên nhiều phần của kho (`multipart_upload_id`), `uploadId` hay tên tệp gốc. Chạy luồng đủ: tải một lần, tải nhiều phần,
// bị bác (tệp giả), hủy, rồi quét toàn bộ nhật ký của ứng dụng.
import { StartUploadResponse, PartUrlsResponse } from '@app/shared/media';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { QueueLifecycle } from '../../src/modules/queue';
import {
  createTestApp,
  registerAndVerify,
  type Agent,
  type MeBody,
  type TestApp,
} from '../auth/helpers/app';
import { asOwner, describeDb } from '../db/helpers/db';
import {
  UPLOADS,
  browserUploadSingle,
  fixture,
  startUpload,
  storageOf,
  uniqueJpeg,
  type FileSpec,
} from './helpers';

const MIB = 1024 * 1024;

describeDb('Bí mật không lọt vào nhật ký khi tải lên thư viện media (e2e)', () => {
  let t: TestApp;
  let owner: { agent: Agent; me: MeBody };
  const secrets = new Set<string>();
  /** Mã phiên của ứng dụng: nằm trong đường dẫn của nhật ký truy cập chung (core) nên chỉ kiểm ở dòng của module media. */
  const sessionIds = new Set<string>();
  const errorTexts: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    owner = await registerAndVerify(t, { displayName: 'Chị Lan' });
  });
  afterAll(async () => {
    await t.close();
  });

  /** Ghi nhớ mọi giá trị nhạy cảm của một lần bắt đầu tải để quét nhật ký sau đó. */
  function remember(start: StartUploadResponse): void {
    sessionIds.add(start.uploadId);
    if (start.mode === 'single') {
      for (const v of Object.values(start.post.fields)) if (v.length >= 8) secrets.add(v);
      secrets.add(start.post.url);
    }
  }

  it('luồng đủ: một lần + nhiều phần + bị bác + hủy ⇒ nhật ký sạch bí mật và tên tệp', async () => {
    const names = [
      'Ảnh-khách-hàng-bí-mật.jpg',
      'video-nội-bộ-9MiB.mp4',
      'giả-html.jpg',
      'sẽ-hủy.jpg',
    ];
    // 1) tải một lần thành công
    const single: FileSpec = { ...uniqueJpeg(), name: names[0]! };
    const s1 = StartUploadResponse.parse((await startUpload(owner.agent, single)).body);
    remember(s1);
    await browserUploadSingle(t, s1, single.bytes, single.contentType);
    expect((await owner.agent.post(`${UPLOADS}/${s1.uploadId}/complete`)).status).toBe(202);

    // 2) nhiều phần: có `multipart_upload_id` trong CSDL – cũng không được lọt ra nhật ký
    const head = fixture('moov-end.mp4');
    const bytes = Buffer.alloc(9 * MIB);
    head.copy(bytes);
    const big: FileSpec = { name: names[1]!, bytes, contentType: 'video/mp4' };
    const s2 = StartUploadResponse.parse((await startUpload(owner.agent, big)).body);
    remember(s2);
    const urls = PartUrlsResponse.parse(
      (await owner.agent.post(`${UPLOADS}/${s2.uploadId}/part-urls`, { partNumbers: [1, 2] })).body,
    );
    for (const p of urls.parts) secrets.add(p.url);
    await storageOf(t).simulateBrowserUploadPart(urls.parts[0]!.url, bytes.subarray(0, 8 * MIB));
    await storageOf(t).simulateBrowserUploadPart(urls.parts[1]!.url, bytes.subarray(8 * MIB));
    expect((await owner.agent.post(`${UPLOADS}/${s2.uploadId}/complete`)).status).toBe(202);
    const dbRows = await asOwner((c) =>
      c.query<{ multipart_upload_id: string | null }>(
        'SELECT multipart_upload_id FROM media.upload_sessions WHERE multipart_upload_id IS NOT NULL',
      ),
    );
    for (const r of dbRows.rows) secrets.add(r.multipart_upload_id!);

    // 3) bị bác khi xác nhận (tệp HTML đội lốt ảnh) ⇒ lỗi 422 có mã, không có tên tệp
    const fake: FileSpec = {
      name: names[2]!,
      bytes: fixture('fake-html.jpg'),
      contentType: 'image/jpeg',
    };
    const s3 = StartUploadResponse.parse((await startUpload(owner.agent, fake)).body);
    remember(s3);
    await browserUploadSingle(t, s3, fake.bytes, fake.contentType);
    const rejected = await owner.agent.post(`${UPLOADS}/${s3.uploadId}/complete`);
    expect(rejected.status).toBe(422);
    errorTexts.push(JSON.stringify(rejected.body));

    // 4) hủy giữa chừng
    const cancel: FileSpec = { ...uniqueJpeg(), name: names[3]! };
    const s4 = StartUploadResponse.parse((await startUpload(owner.agent, cancel)).body);
    remember(s4);
    expect((await owner.agent.delete(`${UPLOADS}/${s4.uploadId}`)).status).toBe(204);

    // 5) đợi việc nền xử lý ảnh/video chạy (nếu có) rồi quét
    await new Promise((r) => setTimeout(r, 1500));

    const logs = t.rawLogs.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    const haystack = `${logs}\n${errorTexts.join('\n')}`;
    for (const secret of secrets) {
      expect(haystack, 'lộ giá trị nhạy cảm của tải lên').not.toContain(secret);
    }
    // Dòng nhật ký do chính module media ghi (context 'media') và thông điệp lỗi: không chứa mã phiên tải lên.
    // Phần do module ghi: bỏ `req`/`res` (nhật ký truy cập chung của core gắn kèm đường dẫn yêu cầu, có mã phiên trong URL).
    const mediaLines = t.rawLogs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.context === 'media')
      .map((entry) => {
        const own = { ...entry };
        delete own.req;
        delete own.res;
        return JSON.stringify(own);
      })
      .join('\n');
    const errorsText = errorTexts.join('\n');
    for (const id of sessionIds) {
      expect(`${mediaLines}\n${errorsText}`, 'lộ mã phiên tải lên').not.toContain(id);
    }
    for (const name of names) {
      expect(haystack, `lộ tên tệp ${name}`).not.toContain(name);
    }
    // không URL ký sẵn của kho (memory://) hay trường chính sách POST nào trong nhật ký
    expect(logs).not.toMatch(/memory:\/\/(get|put|post)\//);
    expect(logs).not.toMatch(/X-Amz-|"policy"|signature=/i);
    // các sự kiện nghiệp vụ vẫn được ghi (nhật ký không bị tắt để "sạch")
    expect(logs).toContain('media.upload.started');
    expect(logs).toContain('media.upload.rejected');
  });
});
