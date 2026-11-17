// US6 – xem, tìm, xóa media (014 T074, contracts/media-http-api.md mục 7–10, FR-018/021, SC-009): lọc theo loại/ngày/tên, phân trang con trỏ,
// chi tiết, bài đang dùng, xóa có cảnh báo (chặn khi bài đã duyệt/lên lịch), cộng tác viên chỉ xóa tệp mình tải, hoàn dung lượng ngay.
import { ListResponse, MediaDetail, UsagesResponse } from '@app/shared/media';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import {
  registerMediaUsageProvider,
  resetMediaUsageProviderForTests,
  type MediaUsageRef,
} from '../../src/modules/media/internal/usage-registry';
import { QueueLifecycle } from '../../src/modules/queue';
import { collaboratorOf } from '../auth/helpers/actors';
import {
  createTestApp,
  registerAndVerify,
  type Agent,
  type MeBody,
  type TestApp,
} from '../auth/helpers/app';
import { asOwner, describeDb } from '../db/helpers/db';
import { MEDIA, expectError, jobCount, quotaRow } from './helpers';

type Seed = {
  kind?: 'image' | 'video';
  status?: 'ready' | 'processing' | 'unprocessable' | 'uploading';
  name: string;
  by: string;
  createdAt?: string;
  bytes?: number;
  deleted?: boolean;
};

describeDb('Xem, tìm, xóa media (e2e)', () => {
  let t: TestApp;
  let owner: { agent: Agent; me: MeBody };
  let collaborator: { agent: Agent; userId: string };
  let stranger: { agent: Agent; me: MeBody };
  let accountId: string;
  let usages: MediaUsageRef[] = [];

  async function seed(s: Seed): Promise<string> {
    const id = uuidV7();
    const kind = s.kind ?? 'image';
    const status = s.status ?? 'ready';
    const ready = status === 'ready';
    await asOwner((c) =>
      c.query(
        `INSERT INTO media.media (id, account_id, kind, status, display_name, original_content_type, original_bytes, uploaded_by_user_id,
            file_hash, width, height, duration_ms, processed_at, normalized_bytes, thumb_bytes, failure_code, created_at, deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, $9,$10,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          id,
          accountId,
          kind,
          status,
          s.name,
          kind === 'image' ? 'image/png' : 'video/mp4',
          s.bytes ?? 1000,
          s.by,
          ready ? id.replace(/-/g, '').padEnd(64, 'e') : null,
          ready ? 640 : null,
          ready && kind === 'video' ? 4000 : null,
          ready || status === 'unprocessable' ? new Date() : null,
          ready && kind === 'image' ? 400 : null,
          ready ? 50 : null,
          status === 'unprocessable' ? 'corrupt' : null,
          s.createdAt ?? new Date().toISOString(),
          s.deleted === true ? new Date() : null,
        ],
      ),
    );
    return id;
  }
  const setQuotaUsed = (used: number) =>
    asOwner((c) =>
      c.query(
        `INSERT INTO media.storage_quotas (id, account_id, used_bytes, limit_bytes) VALUES (gen_random_uuid(), $1, $2, 5368709120)
         ON CONFLICT (account_id) DO UPDATE SET used_bytes = $2, reserved_bytes = 0`,
        [accountId, used],
      ),
    );
  const deletedAt = (id: string) =>
    asOwner(
      async (c) =>
        (await c.query('SELECT deleted_at FROM media.media WHERE id = $1', [id])).rows[0]
          ?.deleted_at as Date | null,
    );
  const list = async (qs = '', agent = owner.agent) => {
    const res = await agent.get(`${MEDIA}${qs}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return ListResponse.parse(res.body);
  };

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    owner = await registerAndVerify(t, { displayName: 'Chị Lan' });
    collaborator = await collaboratorOf(t, owner.me);
    stranger = await registerAndVerify(t, { displayName: 'Chủ B' });
    accountId = owner.me.account.id;
    registerMediaUsageProvider({
      findUsages: (ids) => Promise.resolve(usages.filter((u) => ids.includes(u.mediaId))),
    });
  });
  afterAll(async () => {
    resetMediaUsageProviderForTests();
    await t.close();
  });
  afterEach(() => {
    usages = [];
  });

  describe('danh sách, lọc, tìm, phân trang', () => {
    let ids: Record<string, string>;
    beforeAll(async () => {
      const me = owner.me.user.id;
      ids = {
        old: await seed({ name: 'Áo Dài Đỏ.png', by: me, createdAt: '2026-10-01T05:00:00Z' }),
        mid: await seed({ name: 'ao-dai-xanh.png', by: me, createdAt: '2026-10-15T05:00:00Z' }),
        video: await seed({
          name: 'Khai trương.mp4',
          kind: 'video',
          by: me,
          createdAt: '2026-10-20T05:00:00Z',
        }),
        proc: await seed({
          name: 'dang-xu-ly.png',
          status: 'processing',
          by: me,
          createdAt: '2026-10-25T05:00:00Z',
        }),
        bad: await seed({
          name: 'hong.png',
          status: 'unprocessable',
          by: me,
          createdAt: '2026-10-26T05:00:00Z',
        }),
        uploading: await seed({ name: 'dang-tai.png', status: 'uploading', by: me }),
        gone: await seed({ name: 'da-xoa.png', by: me, deleted: true }),
      };
    });

    it('mới nhất trước; KHÔNG có media đang tải và đã xóa mềm; kèm dung lượng; chỉ của tài khoản', async () => {
      const r = await list();
      const order = r.items.map((i) => i.id);
      expect(order).toEqual([ids.bad, ids.proc, ids.video, ids.mid, ids.old]);
      expect(order).not.toContain(ids.uploading);
      expect(order).not.toContain(ids.gone);
      expect(r.quota.limitBytes).toBe(5 * 1024 ** 3);
      expect((await list('', stranger.agent)).items).toEqual([]);
      const bad = r.items[0]!;
      expect(bad).toMatchObject({
        status: 'unprocessable',
        thumbUrl: null,
        failure: { code: 'corrupt' },
      });
      expect(bad.failure!.action).toBeTruthy();
      expect(r.items[2]).toMatchObject({ kind: 'video', durationMs: 4000, status: 'ready' });
      expect(r.items[2]!.thumbUrl).toMatch(/^memory:\/\/get\//);
    });

    it('lọc theo loại, khoảng ngày (UTC) và tên (không phân biệt hoa/thường, chỉ trong tài khoản)', async () => {
      expect((await list('?kind=video')).items.map((i) => i.id)).toEqual([ids.video]);
      expect((await list('?kind=image')).items.map((i) => i.id)).toEqual([
        ids.bad,
        ids.proc,
        ids.mid,
        ids.old,
      ]);
      const dated = await list(
        `?from=${encodeURIComponent('2026-10-10T00:00:00Z')}&to=${encodeURIComponent('2026-10-21T00:00:00Z')}`,
      );
      expect(dated.items.map((i) => i.id)).toEqual([ids.video, ids.mid]);
      expect((await list('?q=ÁO%20DÀI')).items.map((i) => i.id)).toEqual([ids.old]); // hoa/thường Unicode
      expect((await list('?q=ao-dai')).items.map((i) => i.id)).toEqual([ids.mid]);
      expect((await list('?q=khai')).items.map((i) => i.id)).toEqual([ids.video]);
      expect((await list('?q=%25')).items).toEqual([]); // ký tự đặc biệt của LIKE được thoát
      expect((await list('?q=ao-dai', stranger.agent)).items).toEqual([]);
    });

    it('phân trang theo con trỏ, không trùng/sót; con trỏ hỏng ⇒ 400', async () => {
      const p1 = await list('?limit=2');
      expect(p1.items).toHaveLength(2);
      expect(p1.nextCursor).not.toBeNull();
      const p2 = await list(`?limit=2&cursor=${p1.nextCursor!}`);
      const p3 = await list(`?limit=2&cursor=${p2.nextCursor!}`);
      expect(p3.nextCursor).toBeNull();
      expect([...p1.items, ...p2.items, ...p3.items].map((i) => i.id)).toEqual([
        ids.bad,
        ids.proc,
        ids.video,
        ids.mid,
        ids.old,
      ]);
      expect((await owner.agent.get(`${MEDIA}?cursor=khong-hop-le`)).status).toBe(400);
      expect((await owner.agent.get(`${MEDIA}?limit=61`)).status).toBe(400);
    });

    it('chi tiết: ảnh ⇒ bản chuẩn hóa, video ⇒ tệp gốc (≤ 1 giờ); không có/xóa mềm/đang tải/tài khoản khác ⇒ 404 cùng thông điệp', async () => {
      const img = MediaDetail.parse((await owner.agent.get(`${MEDIA}/${ids.old}`)).body);
      expect(img).toMatchObject({ id: ids.old, mimeType: 'image/jpeg', width: 640 });
      expect(decodeURIComponent(img.previewUrl!)).toContain(`/media/${ids.old}/normalized/jpeg`);
      const vid = MediaDetail.parse((await owner.agent.get(`${MEDIA}/${ids.video}`)).body);
      expect(decodeURIComponent(vid.previewUrl!)).toContain(`/media/${ids.video}/original`);
      expect(vid.mimeType).toBe('video/mp4');
      const processing = MediaDetail.parse((await owner.agent.get(`${MEDIA}/${ids.proc}`)).body);
      expect(processing.previewUrl).toBeNull();
      const messages = new Set<string>();
      for (const id of [uuidV7(), ids.gone, ids.uploading]) {
        const res = await owner.agent.get(`${MEDIA}/${id}`);
        messages.add(expectError(res, 404, 'NOT_FOUND').message);
      }
      messages.add(
        expectError(await stranger.agent.get(`${MEDIA}/${ids.old}`), 404, 'NOT_FOUND').message,
      );
      expect([...messages]).toEqual(['Tệp này không còn trong thư viện.']);
    });

    it('/usages: blocking khi có bài approved/scheduled; chỉ bài của tài khoản', async () => {
      usages = [
        { mediaId: ids.old!, postId: uuidV7(), postTitle: 'Khai trương', postStatus: 'draft' },
        { mediaId: ids.old!, postId: uuidV7(), postTitle: '', postStatus: 'scheduled' },
      ];
      const r = UsagesResponse.parse((await owner.agent.get(`${MEDIA}/${ids.old}/usages`)).body);
      expect(r.blocking).toBe(true);
      expect(r.usages.map((u) => u.postTitle)).toEqual(['Khai trương', 'Bài chưa đặt tên']);
      usages = [{ mediaId: ids.old!, postId: uuidV7(), postTitle: 'x', postStatus: 'published' }];
      expect(
        UsagesResponse.parse((await owner.agent.get(`${MEDIA}/${ids.old}/usages`)).body).blocking,
      ).toBe(false);
      usages = [];
      expect(
        UsagesResponse.parse((await owner.agent.get(`${MEDIA}/${ids.old}/usages`)).body),
      ).toEqual({ usages: [], blocking: false });
      expect((await stranger.agent.get(`${MEDIA}/${ids.old}/usages`)).status).toBe(404);
    });
  });

  describe('xóa', () => {
    it('không bài nào dùng ⇒ 204: xóa mềm, dung lượng trả NGAY, tạo đúng một việc media.purge_files; lần hai ⇒ 404', async () => {
      const id = await seed({ name: 'xoa-duoc.png', by: owner.me.user.id, bytes: 700 });
      await setQuotaUsed(700);
      const res = await owner.agent.delete(`${MEDIA}/${id}`);
      expect(res.status).toBe(204);
      expect(await deletedAt(id)).not.toBeNull();
      expect((await quotaRow(accountId))!.used).toBe(0);
      expect(await jobCount('media.purge_files', id)).toBe(1);
      expect((await list()).items.map((i) => i.id)).not.toContain(id);
      expectError(await owner.agent.delete(`${MEDIA}/${id}`), 404, 'NOT_FOUND');
      expect((await quotaRow(accountId))!.used).toBe(0); // không trả hai lần
      expect(await jobCount('media.purge_files', id)).toBe(1);
    });

    it('bài approved/scheduled dùng ⇒ 409 MEDIA_IN_USE + danh sách bài; KHÔNG có trạng thái xóa dở (kể cả confirm=true)', async () => {
      const id = await seed({ name: 'dang-dung.png', by: owner.me.user.id, bytes: 500 });
      await setQuotaUsed(500);
      usages = [
        { mediaId: id, postId: uuidV7(), postTitle: 'Giảm giá', postStatus: 'scheduled' },
        { mediaId: id, postId: uuidV7(), postTitle: 'Khai trương', postStatus: 'approved' },
      ];
      for (const qs of ['', '?confirm=true']) {
        const res = await owner.agent.delete(`${MEDIA}/${id}${qs}`);
        const error = expectError(res, 409, 'MEDIA_IN_USE');
        expect(error.message).toContain('2 bài đã duyệt hoặc đã lên lịch');
        expect(error.actions[0]).toMatchObject({ kind: 'navigate', label: 'Mở bài để đổi media' });
        expect((error.extra as { usages: unknown[] }).usages).toHaveLength(2);
        expect(await deletedAt(id)).toBeNull();
      }
      expect((await quotaRow(accountId))!.used).toBe(500);
      expect(await jobCount('media.purge_files', id)).toBe(0);
    });

    it('chỉ bài nháp/chờ duyệt/đã đăng dùng ⇒ 409 MEDIA_USED_CONFIRM_REQUIRED, rồi confirm=true ⇒ 204', async () => {
      const id = await seed({ name: 'co-nhap.png', by: owner.me.user.id, bytes: 300 });
      await setQuotaUsed(300);
      usages = [
        { mediaId: id, postId: uuidV7(), postTitle: 'Nháp A', postStatus: 'draft' },
        { mediaId: id, postId: uuidV7(), postTitle: 'Đã đăng B', postStatus: 'published' },
      ];
      const first = expectError(
        await owner.agent.delete(`${MEDIA}/${id}`),
        409,
        'MEDIA_USED_CONFIRM_REQUIRED',
      );
      expect((first.extra as { usages: unknown[] }).usages).toHaveLength(2);
      expect(await deletedAt(id)).toBeNull();
      expect((await owner.agent.delete(`${MEDIA}/${id}?confirm=true`)).status).toBe(204);
      expect(await deletedAt(id)).not.toBeNull();
      expect((await quotaRow(accountId))!.used).toBe(0);
    });

    it('tra bài dùng LẠI lúc xóa (không tin /usages đã hỏi trước đó)', async () => {
      const id = await seed({ name: 'doi-y.png', by: owner.me.user.id });
      usages = [];
      expect(
        UsagesResponse.parse((await owner.agent.get(`${MEDIA}/${id}/usages`)).body).blocking,
      ).toBe(false);
      usages = [
        { mediaId: id, postId: uuidV7(), postTitle: 'Vừa lên lịch', postStatus: 'scheduled' },
      ]; // bài vừa được lên lịch
      expectError(await owner.agent.delete(`${MEDIA}/${id}?confirm=true`), 409, 'MEDIA_IN_USE');
    });

    it('cộng tác viên chỉ xóa tệp MÌNH tải; chủ xóa mọi tệp; canDelete phản ánh đúng', async () => {
      const ownersFile = await seed({ name: 'cua-chu.png', by: owner.me.user.id });
      const mine = await seed({ name: 'cua-ctv.png', by: collaborator.userId });
      const view = await list('', collaborator.agent);
      expect(view.items.find((i) => i.id === ownersFile)!.canDelete).toBe(false);
      expect(view.items.find((i) => i.id === mine)!.canDelete).toBe(true);
      expect((await list('', owner.agent)).items.find((i) => i.id === mine)!.canDelete).toBe(true);
      const res = await collaborator.agent.delete(`${MEDIA}/${ownersFile}`);
      const error = expectError(res, 403, 'MEDIA_DELETE_NOT_OWNER');
      expect(error.message).toContain('Bạn chỉ xóa được ảnh/video do chính mình tải lên');
      expect(await deletedAt(ownersFile)).toBeNull();
      expect((await collaborator.agent.delete(`${MEDIA}/${mine}`)).status).toBe(204);
      expect((await owner.agent.delete(`${MEDIA}/${ownersFile}`)).status).toBe(204);
    });

    it('đang tải (`uploading`) ⇒ 404 (dùng DELETE /media/uploads/:id); tài khoản khác ⇒ 404 và không đụng dữ liệu', async () => {
      const up = await seed({ name: 'dang-tai-2.png', status: 'uploading', by: owner.me.user.id });
      expectError(await owner.agent.delete(`${MEDIA}/${up}`), 404, 'NOT_FOUND');
      const other = await seed({ name: 'cua-a.png', by: owner.me.user.id });
      expectError(await stranger.agent.delete(`${MEDIA}/${other}`), 404, 'NOT_FOUND');
      expect(await deletedAt(other)).toBeNull();
    });

    it('"Không xử lý được" xóa được và KHÔNG trả dung lượng lần nữa (đã trả khi chuyển trạng thái)', async () => {
      const id = await seed({
        name: 'hong-2.png',
        status: 'unprocessable',
        by: owner.me.user.id,
        bytes: 900,
      });
      await setQuotaUsed(250);
      expect((await owner.agent.delete(`${MEDIA}/${id}`)).status).toBe(204);
      expect((await quotaRow(accountId))!.used).toBe(250); // không đổi
      expect(await jobCount('media.purge_files', id)).toBe(1);
    });

    it('đang xử lý (`processing`) xóa được và trả dung lượng', async () => {
      const id = await seed({
        name: 'xu-ly-xoa.png',
        status: 'processing',
        by: owner.me.user.id,
        bytes: 400,
      });
      await setQuotaUsed(400);
      expect((await owner.agent.delete(`${MEDIA}/${id}`)).status).toBe(204);
      expect((await quotaRow(accountId))!.used).toBe(0);
    });

    it('hai người cùng xóa một tệp ⇒ nhất quán: một 204, một 404; bộ đếm trả một lần, không âm', async () => {
      const id = await seed({ name: 'dua-xoa.png', by: collaborator.userId, bytes: 600 });
      await setQuotaUsed(600);
      const [a, b] = await Promise.all([
        owner.agent.delete(`${MEDIA}/${id}`),
        collaborator.agent.delete(`${MEDIA}/${id}`),
      ]);
      expect([a.status, b.status].sort()).toEqual([204, 404]);
      expect((await quotaRow(accountId))!.used).toBe(0);
      expect(await jobCount('media.purge_files', id)).toBe(1);
    });
  });
});
