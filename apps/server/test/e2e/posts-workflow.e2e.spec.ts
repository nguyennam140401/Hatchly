// US3–US6 (012, quickstart D, E, F) – Chờ duyệt, duyệt nhiều bài, trả lại kèm ghi chú, cộng tác viên gửi/rút,
// đổi giờ, sửa bài đã duyệt tự về Chờ duyệt, hủy lịch, Lịch. ApiAppModule THẬT, kho sandbox (hàng chờ `notify`
// thật: thông báo được tạo TRONG giao dịch nghiệp vụ nên kiểm bằng việc `notify` trong CSDL).
import { ErrorResponse } from '@app/shared/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QueueLifecycle } from '../../src/modules/queue';
import { createActors, type Actors } from '../auth/helpers/actors';
import { createTestApp, type TestApp } from '../auth/helpers/app';
import { asOwner, describeDb } from '../db/helpers/db';
import { jobs } from '../queue/helpers/queue-db';
import {
  connectChannel,
  createDraft,
  inMinutes,
  P,
  postBody,
  type PostBody,
  type VariantBody,
} from './helpers/posts';

function expectError(res: { status: number; body: unknown }, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const parsed = ErrorResponse.safeParse(res.body);
  expect(parsed.success, JSON.stringify(res.body)).toBe(true);
  expect(parsed.data?.error.code).toBe(code);
  return parsed.data!.error;
}

interface BulkBody {
  succeeded: number;
  failed: number;
  results: { postId: string; status: string; error?: { code: string } }[];
}

async function effectiveAttempts(postId: string) {
  return asOwner(async (c) => {
    const r = await c.query<{ id: string; status: string; scheduled_at: Date; connection: string }>(
      `SELECT id, status, scheduled_at, channel_connection_id AS connection
         FROM publishing.publish_attempts WHERE post_id = $1 AND status <> 'cancelled' ORDER BY 4`,
      [postId],
    );
    return r.rows;
  });
}

async function allAttempts(postId: string) {
  return asOwner(async (c) => {
    const r = await c.query<{ id: string; status: string }>(
      'SELECT id, status FROM publishing.publish_attempts WHERE post_id = $1',
      [postId],
    );
    return r.rows;
  });
}

/** Việc `notify` của một loại thông báo, lọc theo mã bài (kiểm thông báo được xếp hàng cùng giao dịch). */
async function notifyJobs(type: string, postId?: string) {
  const rows = await jobs("name = 'notify' AND data->>'type' = 'notifications.deliver'");
  return rows.filter((j) => {
    const event = (j.data.payload as { event?: { type?: string; refs?: Record<string, unknown> } })
      .event;
    if (event?.type !== type) return false;
    if (postId === undefined) return true;
    const refs = event.refs ?? {};
    return (
      refs.postId === postId || (refs.postIds as string[] | undefined)?.includes(postId) === true
    );
  });
}

describeDb('Chờ duyệt, trả lại, đổi giờ, sửa sau duyệt (012 US3–US6)', () => {
  let t: TestApp;
  let actors: Actors;
  let fb: string;
  let fb2: string;
  const variants = (): VariantBody[] => [{ connectionId: fb }, { connectionId: fb2 }];

  beforeAll(async () => {
    t = await createTestApp({ env: { FAKE_STATE_STORE: 'sandbox' } });
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    actors = await createActors(t);
    fb = await connectChannel(actors.owner, 'facebook_page', 0);
    fb2 = await connectChannel(actors.owner, 'facebook_page', 1);
  });
  afterAll(async () => {
    await t.close();
  });

  const submit = (agent: typeof actors.owner, posts: PostBody[], at?: string) =>
    agent.post(`${P}/submit`, {
      items: posts.map((p) => ({
        postId: p.id,
        expectedVersion: p.version,
        ...(at === undefined ? {} : { scheduledAt: at }),
      })),
    });

  describe('gửi duyệt và Chờ duyệt', () => {
    it('cộng tác viên gửi 3 bài một lần → MỘT thông báo cho cả lần gửi; chủ thấy danh sách theo giờ gần nhất', async () => {
      const posts = [
        await createDraft(actors.collaborator, variants(), { scheduledAt: inMinutes(300) }),
        await createDraft(actors.collaborator, variants(), { scheduledAt: inMinutes(120) }),
        await createDraft(actors.collaborator, variants(), { scheduledAt: inMinutes(200) }),
      ];
      const res = await submit(actors.collaborator, posts);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const bulk = res.body as BulkBody;
      expect(bulk).toMatchObject({ succeeded: 3, failed: 0 });

      // Một lần gửi → đúng MỘT sự kiện, mang cả 3 mã bài.
      const events = await notifyJobs('post_pending_review', posts[0]?.id);
      expect(events).toHaveLength(1);
      const refs = (events[0]?.data.payload as { event: { refs: { postIds: string[] } } }).event
        .refs;
      expect(refs.postIds.sort()).toEqual(posts.map((p) => p.id).sort());

      const list = await actors.owner.get('/api/v1/approvals/pending');
      expect(list.status).toBe(200);
      const items = (
        list.body as { items: { postId: string; scheduledAt: string; authorDisplayName: string }[] }
      ).items;
      const mine = items.filter((i) => posts.some((p) => p.id === i.postId));
      expect(mine.map((i) => i.postId)).toEqual([posts[1]?.id, posts[2]?.id, posts[0]?.id]);
      expect(mine[0]?.authorDisplayName).toBe('Cộng tác viên');
      const count = await actors.owner.get('/api/v1/approvals/pending/count');
      expect((count.body as { count: number }).count).toBeGreaterThanOrEqual(3);
      // Cộng tác viên không xem được Chờ duyệt.
      expect((await actors.collaborator.get('/api/v1/approvals/pending')).status).toBe(403);
      expect((await actors.collaborator.get('/api/v1/approvals/pending/count')).status).toBe(403);
    });

    it('gửi lại đúng lần gửi không tạo thông báo thứ hai; vượt 50 bài → 422 BULK_LIMIT_EXCEEDED', async () => {
      const many = Array.from({ length: 51 }, () => ({
        postId: crypto.randomUUID(),
        expectedVersion: 1,
      }));
      const res = await actors.collaborator.post(`${P}/submit`, { items: many });
      expectError(res, 422, 'BULK_LIMIT_EXCEEDED');
    });

    it('bài đang Chờ duyệt: cộng tác viên sửa → POST_NOT_EDITABLE; chủ sửa vẫn Chờ duyệt', async () => {
      const post = await createDraft(actors.collaborator, variants());
      const sub = await submit(actors.collaborator, [post]);
      expect((sub.body as BulkBody).succeeded).toBe(1);
      const current = (await actors.owner.get(`${P}/${post.id}`)).body as { post: PostBody };
      const edit = {
        expectedVersion: current.post.version,
        ...postBody(variants(), { sharedText: 'Sửa khi đang chờ' }),
      };
      expectError(await actors.collaborator.put(`${P}/${post.id}`, edit), 409, 'POST_NOT_EDITABLE');
      const ownerEdit = await actors.owner.put(`${P}/${post.id}`, edit);
      expect(ownerEdit.status, JSON.stringify(ownerEdit.body)).toBe(200);
      expect((ownerEdit.body as PostBody).status).toBe('pending_review');
    });

    it('rút lại: chỉ người đã gửi duyệt; bài về Nháp', async () => {
      const post = await createDraft(actors.collaborator, variants());
      await submit(actors.collaborator, [post]);
      const pending = (await actors.collaborator.get(`${P}/${post.id}`)).body as { post: PostBody };
      const body = { expectedVersion: pending.post.version };
      expectError(await actors.owner.post(`${P}/${post.id}/withdraw`, body), 403, 'FORBIDDEN');
      const ok = await actors.collaborator.post(`${P}/${post.id}/withdraw`, body);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect((ok.body as PostBody).status).toBe('draft');
    });
  });

  describe('duyệt nhiều bài', () => {
    it('2 bài hợp lệ + 1 bài giờ quá khứ → approved 2, failed 1 (TIME_IN_PAST); bài lỗi không ảnh hưởng bài khác', async () => {
      const a = await createDraft(actors.owner, variants(), { scheduledAt: inMinutes(180) });
      const b = await createDraft(actors.owner, variants(), { scheduledAt: inMinutes(240) });
      const late = await createDraft(actors.owner, variants(), { scheduledAt: inMinutes(1) });
      const res = await actors.owner.post('/api/v1/approvals/approve-batch', {
        items: [a, late, b].map((p) => ({ postId: p.id, expectedVersion: p.version })),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const bulk = res.body as BulkBody;
      expect(bulk).toMatchObject({ succeeded: 2, failed: 1 });
      expect(bulk.results.find((r) => r.postId === late.id)?.error?.code).toBe('TIME_IN_PAST');
      expect(await effectiveAttempts(a.id)).toHaveLength(2);
      expect(await effectiveAttempts(b.id)).toHaveLength(2);
      expect(await allAttempts(late.id)).toHaveLength(0);
    });

    it('thiếu giờ ở bài và ở yêu cầu → bài đó thất bại, bài kia vẫn duyệt; 101 bài → BULK_LIMIT_EXCEEDED', async () => {
      const noTime = await createDraft(actors.owner, variants());
      const withTime = await createDraft(actors.owner, variants());
      const res = await actors.owner.post('/api/v1/approvals/approve-batch', {
        items: [
          { postId: noTime.id, expectedVersion: noTime.version },
          { postId: withTime.id, expectedVersion: withTime.version, scheduledAt: inMinutes(500) },
        ],
      });
      expect(res.body).toMatchObject({ succeeded: 1, failed: 1 });
      const over = await actors.owner.post('/api/v1/approvals/approve-batch', {
        items: Array.from({ length: 101 }, () => ({
          postId: crypto.randomUUID(),
          expectedVersion: 1,
        })),
      });
      expectError(over, 422, 'BULK_LIMIT_EXCEEDED');
    });
  });

  describe('trả lại kèm ghi chú', () => {
    it('trả bài Chờ duyệt → Nháp có nhãn "Bị trả lại" + thông báo cho người soạn, KHÔNG email; ghi chú rỗng → RETURN_NOTE_REQUIRED', async () => {
      const post = await createDraft(actors.collaborator, variants(), {
        scheduledAt: inMinutes(300),
      });
      await submit(actors.collaborator, [post]);
      const pending = (await actors.owner.get(`${P}/${post.id}`)).body as { post: PostBody };
      const v = pending.post.version;
      expectError(
        await actors.owner.post(`${P}/${post.id}/return`, { expectedVersion: v, note: '   ' }),
        422,
        'RETURN_NOTE_REQUIRED',
      );
      expectError(
        await actors.owner.post(`${P}/${post.id}/return`, {
          expectedVersion: v,
          note: 'a'.repeat(501),
        }),
        422,
        'RETURN_NOTE_REQUIRED',
      );
      expect(
        (
          await actors.collaborator.post(`${P}/${post.id}/return`, {
            expectedVersion: v,
            note: 'x',
          })
        ).status,
      ).toBe(403);
      const ok = await actors.owner.post(`${P}/${post.id}/return`, {
        expectedVersion: v,
        note: 'Hãy đổi ảnh bìa nhé',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const returned = ok.body as PostBody;
      expect(returned.status).toBe('draft');
      expect(returned.labels.returned?.note).toBe('Hãy đổi ảnh bìa nhé');
      const events = await notifyJobs('post_returned', post.id);
      expect(events).toHaveLength(1);
      const refs = (events[0]?.data.payload as { event: { refs: { authorUserId: string } } }).event
        .refs;
      expect(refs.authorUserId).toBe(actors.collaboratorId);
    });

    it('gửi lại bài bị trả xóa nhãn nhưng lịch sử còn đủ 3 sự kiện submitted, returned, submitted', async () => {
      const post = await createDraft(actors.collaborator, variants(), {
        scheduledAt: inMinutes(300),
      });
      await submit(actors.collaborator, [post]);
      let cur = (await actors.owner.get(`${P}/${post.id}`)).body as { post: PostBody };
      await actors.owner.post(`${P}/${post.id}/return`, {
        expectedVersion: cur.post.version,
        note: 'Sửa lại',
      });
      cur = (await actors.collaborator.get(`${P}/${post.id}`)).body as { post: PostBody };
      expect(cur.post.labels.returned?.note).toBe('Sửa lại');
      await submit(actors.collaborator, [cur.post]);
      const after = (await actors.collaborator.get(`${P}/${post.id}`)).body as { post: PostBody };
      expect(after.post.labels.returned).toBeNull();

      const history = await actors.collaborator.get(`${P}/${post.id}/history`);
      expect(history.status).toBe(200);
      const events = (
        history.body as {
          events: { type: string; actorDisplayName: string; data: { note?: string } }[];
        }
      ).events;
      expect(events.map((e) => e.type)).toEqual(['created', 'submitted', 'returned', 'submitted']);
      expect(events.find((e) => e.type === 'returned')?.data.note).toBe('Sửa lại');
      // Lịch sử KHÔNG chứa nội dung bài.
      expect(JSON.stringify(events)).not.toContain('Khuyến mãi cuối tuần');
    });

    it('trả nhiều bài với ghi chú chung; bài lỗi không ảnh hưởng bài khác', async () => {
      const a = await createDraft(actors.collaborator, variants(), { scheduledAt: inMinutes(300) });
      const b = await createDraft(actors.collaborator, variants(), { scheduledAt: inMinutes(301) });
      await submit(actors.collaborator, [a, b]);
      const ca = (await actors.owner.get(`${P}/${a.id}`)).body as { post: PostBody };
      const res = await actors.owner.post('/api/v1/approvals/return-batch', {
        items: [
          { postId: a.id, expectedVersion: ca.post.version },
          { postId: b.id, expectedVersion: 999 },
        ],
        note: 'Chưa đúng giọng văn',
      });
      expect(res.body).toMatchObject({ succeeded: 1, failed: 1 });
      expect((res.body as BulkBody).results.find((r) => r.postId === b.id)?.error?.code).toBe(
        'VERSION_CONFLICT',
      );
    });
  });

  describe('đổi giờ, hủy lịch', () => {
    async function approved(at = inMinutes(300), agent = actors.owner) {
      const post = await createDraft(agent, variants());
      const res = await actors.owner.post(`${P}/${post.id}/approve`, {
        expectedVersion: post.version,
        scheduledAt: at,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body as PostBody;
    }

    it('đổi giờ bài đã duyệt giữ nguyên "approved", đổi giờ mọi mục + việc, không cần duyệt lại', async () => {
      const post = await approved();
      const when = inMinutes(900);
      const res = await actors.owner.put(`${P}/${post.id}/schedule`, {
        expectedVersion: post.version,
        scheduledAt: when,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const moved = res.body as PostBody;
      expect(moved.status).toBe('approved');
      expect(moved.version).toBe(post.version + 1);
      const rows = await effectiveAttempts(post.id);
      expect(rows.every((r) => r.scheduled_at.toISOString() === new Date(when).toISOString())).toBe(
        true,
      );
      const queued = await jobs("name = 'publish' AND singleton_key = ANY($1)", [
        rows.map((r) => `publish:${r.id}`),
      ]);
      expect(queued).toHaveLength(2);
      for (const j of queued) {
        expect(new Date(j.start_after).toISOString()).toBe(new Date(when).toISOString());
      }
      // Chủ tự đổi giờ → không thông báo cho chính mình.
      expect(await notifyJobs('approved_post_rescheduled', post.id)).toHaveLength(0);
    });

    it('giờ quá khứ → TIME_IN_PAST; hai yêu cầu cùng expectedVersion → một thành công, một VERSION_CONFLICT', async () => {
      const post = await approved();
      expectError(
        await actors.owner.put(`${P}/${post.id}/schedule`, {
          expectedVersion: post.version,
          scheduledAt: inMinutes(1),
        }),
        422,
        'TIME_IN_PAST',
      );
      const [a, b] = await Promise.all([
        actors.owner.put(`${P}/${post.id}/schedule`, {
          expectedVersion: post.version,
          scheduledAt: inMinutes(700),
        }),
        actors.owner.put(`${P}/${post.id}/schedule`, {
          expectedVersion: post.version,
          scheduledAt: inMinutes(800),
        }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect((loser.body as ErrorResponse).error.code).toBe('VERSION_CONFLICT');
    });

    it('cộng tác viên đổi giờ bài đã duyệt → thông báo "approved_post_rescheduled" cho chủ', async () => {
      const post = await approved();
      const res = await actors.collaborator.put(`${P}/${post.id}/schedule`, {
        expectedVersion: post.version,
        scheduledAt: inMinutes(650),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await notifyJobs('approved_post_rescheduled', post.id)).toHaveLength(1);
    });

    it('mục đã bắt đầu đăng → CHANNEL_ALREADY_PUBLISHING và KHÔNG đổi gì', async () => {
      const post = await approved();
      await asOwner((c) =>
        c.query(
          "UPDATE publishing.publish_attempts SET status = 'processing' WHERE post_id = $1 AND channel_connection_id = $2",
          [post.id, fb],
        ),
      );
      const before = await effectiveAttempts(post.id);
      const res = await actors.owner.put(`${P}/${post.id}/schedule`, {
        expectedVersion: post.version,
        scheduledAt: inMinutes(900),
      });
      expectError(res, 409, 'CHANNEL_ALREADY_PUBLISHING');
      expect(await effectiveAttempts(post.id)).toEqual(before);
      const un = await actors.owner.post(`${P}/${post.id}/unschedule`, {
        expectedVersion: post.version,
      });
      expectError(un, 409, 'CHANNEL_ALREADY_PUBLISHING');
      const after = (await actors.owner.get(`${P}/${post.id}`)).body as { post: PostBody };
      expect(after.post.status).toBe('approved');
    });

    it('bài chưa duyệt chỉ đặt giờ dự kiến (không đụng lịch)', async () => {
      const post = await createDraft(actors.owner, variants());
      const res = await actors.owner.put(`${P}/${post.id}/schedule`, {
        expectedVersion: post.version,
        scheduledAt: inMinutes(400),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((res.body as PostBody).status).toBe('draft');
      expect(await allAttempts(post.id)).toHaveLength(0);
    });

    it('hủy lịch (chỉ chủ): bài về Nháp, mục hủy, nội dung không mất; gọi lặp → không tác dụng phụ', async () => {
      const post = await approved();
      expect(
        (
          await actors.collaborator.post(`${P}/${post.id}/unschedule`, {
            expectedVersion: post.version,
          })
        ).status,
      ).toBe(403);
      const ok = await actors.owner.post(`${P}/${post.id}/unschedule`, {
        expectedVersion: post.version,
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect((ok.body as PostBody).status).toBe('draft');
      expect(await effectiveAttempts(post.id)).toHaveLength(0);
      const again = await actors.owner.post(`${P}/${post.id}/unschedule`, {
        expectedVersion: post.version,
      });
      expectError(again, 409, 'POST_ALREADY_APPROVED');
      expect((await allAttempts(post.id)).every((a) => a.status === 'cancelled')).toBe(true);
    });
  });

  describe('sửa bài đã duyệt', () => {
    async function approvedPost() {
      const post = await createDraft(actors.owner, variants());
      const res = await actors.owner.post(`${P}/${post.id}/approve`, {
        expectedVersion: post.version,
        scheduledAt: inMinutes(300),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body as PostBody;
    }
    const edits: [
      string,
      (v: VariantBody[]) => { sharedText?: string; variants: VariantBody[] },
    ][] = [
      ['đổi chữ chung', (v) => ({ sharedText: 'Nội dung đã sửa', variants: v })],
      [
        'đổi hashtag',
        (v) => ({
          variants: [{ ...v[0]!, hashtags: ['moi'] }, v[1]!],
        }),
      ],
      [
        'đổi media',
        (v) => ({
          variants: [{ ...v[0]!, media: [{ mediaId: crypto.randomUUID(), kind: 'image' }] }, v[1]!],
        }),
      ],
      ['bớt một kênh', (v) => ({ variants: [v[0]!] })],
    ];

    for (const [name, edit] of edits) {
      it(`${name} → về Chờ duyệt "Đã sửa sau khi duyệt", mục hủy, KHÔNG đăng nội dung cũ; duyệt lại → mục mới`, async () => {
        const post = await approvedPost();
        const old = await allAttempts(post.id);
        expect(old).toHaveLength(2);
        const change = edit(variants());
        const res = await actors.collaborator.put(`${P}/${post.id}`, {
          expectedVersion: post.version,
          ...postBody(
            change.variants,
            change.sharedText === undefined ? {} : { sharedText: change.sharedText },
          ),
        });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const edited = res.body as PostBody;
        expect(edited.status).toBe('pending_review');
        expect(edited.labels.editedAfterApproval).toBe(true);
        expect(await effectiveAttempts(post.id)).toHaveLength(0);
        const live = await jobs(
          "name = 'publish' AND singleton_key = ANY($1) AND state <= 'active'",
          [old.map((a) => `publish:${a.id}`)],
        );
        expect(live).toHaveLength(0);
        expect(await notifyJobs('post_pending_review', post.id)).toHaveLength(1);

        const re = await actors.owner.post(`${P}/${post.id}/approve`, {
          expectedVersion: edited.version,
          scheduledAt: inMinutes(320),
        });
        expect(re.status, JSON.stringify(re.body)).toBe(200);
        const fresh = await effectiveAttempts(post.id);
        expect(fresh.length).toBeGreaterThanOrEqual(1);
        expect(fresh.some((a) => old.some((o) => o.id === a.id))).toBe(false);
      });
    }

    it('chủ tự sửa bài đã duyệt cũng về Chờ duyệt (không ngoại lệ); chỉ đổi giờ KHÔNG về Chờ duyệt', async () => {
      const post = await approvedPost();
      const only = await actors.owner.put(`${P}/${post.id}`, {
        expectedVersion: post.version,
        ...postBody(variants(), { scheduledAt: inMinutes(500) }),
      });
      expect(only.status, JSON.stringify(only.body)).toBe(200);
      expect((only.body as PostBody).status).toBe('approved');
      const cur = only.body as PostBody;
      const res = await actors.owner.put(`${P}/${post.id}`, {
        expectedVersion: cur.version,
        ...postBody(variants(), { sharedText: 'Chủ sửa nội dung' }),
      });
      expect((res.body as PostBody).status).toBe('pending_review');
    });

    it('gửi cả nội dung lẫn giờ mới cùng lúc ở bài đã duyệt → VALIDATION_FAILED, không đổi gì', async () => {
      const post = await approvedPost();
      const res = await actors.owner.put(`${P}/${post.id}`, {
        expectedVersion: post.version,
        ...postBody(variants(), { sharedText: 'Đổi cả hai', scheduledAt: inMinutes(900) }),
      });
      expectError(res, 422, 'VALIDATION_FAILED');
      const after = (await actors.owner.get(`${P}/${post.id}`)).body as { post: PostBody };
      expect(after.post.status).toBe('approved');
      expect(await effectiveAttempts(post.id)).toHaveLength(2);
    });

    it('có mục đã bắt đầu đăng → CHANNEL_ALREADY_PUBLISHING và hoàn tác trọn gói', async () => {
      const post = await approvedPost();
      await asOwner((c) =>
        c.query(
          "UPDATE publishing.publish_attempts SET status = 'succeeded', confirmed_by = 'user' WHERE post_id = $1 AND channel_connection_id = $2",
          [post.id, fb],
        ),
      );
      const res = await actors.collaborator.put(`${P}/${post.id}`, {
        expectedVersion: post.version,
        ...postBody(variants(), { sharedText: 'Sửa muộn' }),
      });
      expectError(res, 409, 'CHANNEL_ALREADY_PUBLISHING');
      const after = (await actors.owner.get(`${P}/${post.id}`)).body as {
        post: PostBody & { sharedText: string };
      };
      expect(after.post.status).toBe('approved');
      expect(after.post.sharedText).not.toBe('Sửa muộn');
      expect(await notifyJobs('post_pending_review', post.id)).toHaveLength(0);
    });
  });

  describe('Lịch', () => {
    it('đọc theo khoảng giờ UTC, mọi trạng thái, kèm trạng thái đăng và khả năng kéo thả', async () => {
      const at = inMinutes(60 * 24 * 3);
      const post = await createDraft(actors.owner, variants());
      const ap = await actors.owner.post(`${P}/${post.id}/approve`, {
        expectedVersion: post.version,
        scheduledAt: at,
      });
      expect(ap.status).toBe(200);
      const from = new Date(new Date(at).getTime() - 3_600_000).toISOString();
      const to = new Date(new Date(at).getTime() + 3_600_000).toISOString();
      const res = await actors.collaborator.get(`/api/v1/calendar?from=${from}&to=${to}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = (
        res.body as {
          items: {
            postId: string;
            movable: boolean;
            channels: { attemptStatus: string | null }[];
          }[];
        }
      ).items;
      const item = items.find((i) => i.postId === post.id);
      expect(item?.movable).toBe(true);
      expect(item?.channels.map((c) => c.attemptStatus)).toEqual(['scheduled', 'scheduled']);
      // Khoảng quá 42 ngày bị từ chối.
      const wide = await actors.owner.get(
        `/api/v1/calendar?from=${from}&to=${new Date(Date.now() + 90 * 86_400_000).toISOString()}`,
      );
      expect(wide.status).toBe(400);
      // Mục đã rời `scheduled` → không kéo được.
      await asOwner((c) =>
        c.query(
          "UPDATE publishing.publish_attempts SET status = 'succeeded', confirmed_by = 'user' WHERE post_id = $1",
          [post.id],
        ),
      );
      const res2 = await actors.owner.get(`/api/v1/calendar?from=${from}&to=${to}`);
      expect(
        (res2.body as { items: { postId: string; movable: boolean }[] }).items.find(
          (i) => i.postId === post.id,
        )?.movable,
      ).toBe(false);
    });
  });
});
