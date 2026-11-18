// Ma trận quyền × điểm cuối + truy cập chéo của thư viện media (014 T033, contracts/media-http-api.md mục 12;
// hiến pháp I, VI: quyền kiểm ở API). Mở rộng khi thêm điểm cuối (T050 part-urls, T076 chi tiết/bài đang dùng).
import { StartUploadResponse } from '@app/shared/media';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { QueueLifecycle } from '../../src/modules/queue';
import { collaboratorOf, staffAgent } from '../auth/helpers/actors';
import {
  createTestApp,
  registerAndVerify,
  type Agent,
  type MeBody,
  type TestApp,
} from '../auth/helpers/app';
import { describeDb } from '../db/helpers/db';
import {
  MEDIA,
  UPLOADS,
  expectError,
  startBody,
  startUpload,
  uniqueJpeg,
  uploadAndComplete,
} from './helpers';

type Call = (agent: Agent) => Promise<{ status: number; body: unknown }>;

describeDb('Quyền và truy cập chéo của thư viện media (e2e)', () => {
  let t: TestApp;
  let owner: { agent: Agent; me: MeBody };
  let collaborator: { agent: Agent; userId: string };
  let support: Agent;
  let admin: Agent;
  let stranger: { agent: Agent; me: MeBody };
  let anonymous: Agent;
  let mediaId: string;
  let uploadId: string;
  let multipartUploadId: string;

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    owner = await registerAndVerify(t, { displayName: 'Chủ A' });
    collaborator = await collaboratorOf(t, owner.me);
    support = (await staffAgent(t, 'support')).agent;
    admin = (await staffAgent(t, 'admin')).agent;
    stranger = await registerAndVerify(t, { displayName: 'Chủ B' });
    anonymous = t.agent();
    // dữ liệu của A: một media đã xác nhận, một phiên đang mở, một phiên nhiều phần đang mở
    mediaId = (await uploadAndComplete(t, owner.agent, uniqueJpeg())).mediaId;
    const open = StartUploadResponse.parse((await startUpload(owner.agent, uniqueJpeg())).body);
    uploadId = open.uploadId;
    const big = {
      name: 'video.mp4',
      bytes: Buffer.alloc(9 * 1024 * 1024),
      contentType: 'video/mp4',
    };
    const bigRes = await owner.agent.post(UPLOADS, startBody(big));
    multipartUploadId = StartUploadResponse.parse(bigRes.body).uploadId;
  });
  afterAll(async () => {
    await t.close();
  });

  /** Mọi điểm cuối với dữ liệu hợp lệ (của tài khoản A) – dùng để thử từng vai trò. */
  function endpoints(): [string, Call][] {
    const f = uniqueJpeg();
    return [
      ['GET /media/quota', (a) => a.get(`${MEDIA}/quota`)],
      ['GET /media', (a) => a.get(MEDIA)],
      ['GET /media/:id', (a) => a.get(`${MEDIA}/${mediaId}`)],
      ['GET /media/:id/usages', (a) => a.get(`${MEDIA}/${mediaId}/usages`)],
      ['DELETE /media/:id', (a) => a.delete(`${MEDIA}/${uuidV7()}`)],
      ['POST /media/uploads', (a) => a.post(UPLOADS, startBody(f))],
      ['GET /media/uploads/:id', (a) => a.get(`${UPLOADS}/${uploadId}`)],
      ['POST /media/uploads/:id/complete', (a) => a.post(`${UPLOADS}/${uploadId}/complete`)],
      [
        'POST /media/uploads/:id/part-urls',
        (a) => a.post(`${UPLOADS}/${multipartUploadId}/part-urls`, { partNumbers: [1] }),
      ],
      ['DELETE /media/uploads/:id', (a) => a.delete(`${UPLOADS}/${uuidV7()}`)],
    ];
  }

  it('chưa đăng nhập ⇒ 401 ở mọi điểm cuối', async () => {
    for (const [name, call] of endpoints()) {
      const res = await call(anonymous);
      expect(res.status, name).toBe(401);
    }
  });

  it('hỗ trợ và quản trị nội bộ không vào được điểm cuối khách hàng (phiên nhân viên ≠ phiên khách; quyền media.* = false)', async () => {
    // Điểm cuối khách hàng chỉ nhận phiên khách hàng: phiên nhân viên không hợp lệ ở đây ⇒ 401 (khớp ma trận 004).
    for (const who of [support, admin]) {
      for (const [name, call] of endpoints()) {
        const res = await call(who);
        expect(res.status, name).toBe(401);
        expectError(res, 401, 'UNAUTHENTICATED');
      }
    }
  });

  it('chủ và cộng tác viên gọi được mọi điểm cuối (không 401/403)', async () => {
    for (const who of [owner.agent, collaborator.agent]) {
      for (const [name, call] of endpoints()) {
        const res = await call(who);
        expect([401, 403], `${name} → ${res.status}`).not.toContain(res.status);
      }
    }
  });

  it('mã media/phiên của tài khoản khác ⇒ 404 NOT_FOUND, KHÔNG phân biệt với mã ngẫu nhiên', async () => {
    const other: [string, (a: Agent, id: string) => Promise<{ status: number; body: unknown }>][] =
      [
        ['GET /media/:id', (a, id) => a.get(`${MEDIA}/${id}`)],
        ['GET /media/:id/usages', (a, id) => a.get(`${MEDIA}/${id}/usages`)],
        ['DELETE /media/:id', (a, id) => a.delete(`${MEDIA}/${id}`)],
      ];
    for (const [name, call] of other) {
      const real = await call(stranger.agent, mediaId);
      const random = await call(stranger.agent, uuidV7());
      expectError(real, 404, 'NOT_FOUND');
      expect(real.body, name).toEqual({
        error: { ...(real.body as { error: object }).error, support: expect.anything() as unknown },
      });
      expect((real.body as { error: { message: string } }).error.message).toBe(
        (random.body as { error: { message: string } }).error.message,
      );
    }
    const uploadCalls: [
      string,
      (a: Agent, id: string) => Promise<{ status: number; body: unknown }>,
    ][] = [
      ['GET /media/uploads/:id', (a, id) => a.get(`${UPLOADS}/${id}`)],
      ['POST /media/uploads/:id/complete', (a, id) => a.post(`${UPLOADS}/${id}/complete`)],
      [
        'POST /media/uploads/:id/part-urls',
        (a, id) => a.post(`${UPLOADS}/${id}/part-urls`, { partNumbers: [1] }),
      ],
    ];
    for (const [name, call] of uploadCalls) {
      const id = name.includes('part-urls') ? multipartUploadId : uploadId;
      const real = await call(stranger.agent, id);
      expect(real.status, name).toBe(404);
      expectError(real, 404, 'NOT_FOUND');
    }
    // DELETE phiên của tài khoản khác: không tác dụng (204) và phiên của A vẫn còn
    expect((await stranger.agent.delete(`${UPLOADS}/${uploadId}`)).status).toBe(204);
    expect((await owner.agent.get(`${UPLOADS}/${uploadId}`)).status).toBe(200);
  });

  it('cộng tác viên không thấy/không đụng phiên tải của chủ (phiên gắn với người tạo)', async () => {
    expect((await collaborator.agent.get(`${UPLOADS}/${uploadId}`)).status).toBe(404);
    expect((await collaborator.agent.post(`${UPLOADS}/${uploadId}/complete`)).status).toBe(404);
  });

  it('thân chứa accountId (hoặc trường lạ) ⇒ 400 – mã tài khoản chỉ lấy từ phiên', async () => {
    const res = await owner.agent.post(UPLOADS, {
      ...startBody(uniqueJpeg()),
      accountId: uuidV7(),
    });
    expect(res.status).toBe(400);
    expectError(res, 400, 'VALIDATION_FAILED');
    const parts = await owner.agent.post(`${UPLOADS}/${multipartUploadId}/part-urls`, {
      partNumbers: [1],
      accountId: uuidV7(),
    });
    expect(parts.status).toBe(400);
    const q = await owner.agent.get(`${MEDIA}?accountId=${uuidV7()}`);
    expect(q.status).toBe(400);
  });

  it('dữ liệu hai tài khoản tách biệt: B không thấy media của A trong danh sách', async () => {
    const list = await stranger.agent.get(MEDIA);
    expect(list.status).toBe(200);
    expect((list.body as { items: unknown[] }).items).toEqual([]);
    const own = await owner.agent.get(MEDIA);
    expect((own.body as { items: { id: string }[] }).items.map((i) => i.id)).toContain(mediaId);
  });
});
