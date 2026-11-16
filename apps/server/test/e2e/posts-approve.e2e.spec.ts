// US2 (012, quickstart B, C) – duyệt và lên lịch trong MỘT thao tác: đúng một mục lịch đăng + một việc mỗi
// kênh, tất cả hoặc không, idempotent khi bấm lặp/song song, lỗi theo kênh gom về một phản hồi.
import { ErrorResponse } from '@app/shared/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QueueLifecycle } from '../../src/modules/queue';
import { createActors, type Actors } from '../auth/helpers/actors';
import { createTestApp, registerAndVerify, type TestApp } from '../auth/helpers/app';
import { asOwner, describeDb } from '../db/helpers/db';
import { connectChannel, createDraft, inMinutes, P, type PostBody } from './helpers/posts';

function expectError(res: { status: number; body: unknown }, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const parsed = ErrorResponse.safeParse(res.body);
  expect(parsed.success, JSON.stringify(res.body)).toBe(true);
  expect(parsed.data?.error.code).toBe(code);
  return parsed.data!.error;
}

async function attemptsOf(
  postId: string,
): Promise<{ status: string; channel_connection_id: string }[]> {
  return asOwner(async (c) => {
    const r = await c.query<{ status: string; channel_connection_id: string }>(
      'SELECT status, channel_connection_id FROM publishing.publish_attempts WHERE post_id = $1 ORDER BY 2',
      [postId],
    );
    return r.rows;
  });
}

async function publishJobsOf(attemptIds: string[]): Promise<number> {
  if (attemptIds.length === 0) return 0;
  return asOwner(async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pgboss.job_common
        WHERE name = 'publish' AND singleton_key = ANY($1) AND state <= 'active'`,
      [attemptIds.map((id) => `publish:${id}`)],
    );
    return Number(r.rows[0]?.n ?? 0);
  });
}

async function attemptIdsOf(postId: string): Promise<string[]> {
  return asOwner(async (c) => {
    const r = await c.query<{ id: string }>(
      "SELECT id FROM publishing.publish_attempts WHERE post_id = $1 AND status <> 'cancelled'",
      [postId],
    );
    return r.rows.map((x) => x.id);
  });
}

describeDb('Duyệt và lên lịch (012 US2)', () => {
  let t: TestApp;
  let actors: Actors;
  let fb: string;
  let fb2: string;
  let ig: string;

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    actors = await createActors(t);
    fb = await connectChannel(actors.owner, 'facebook_page', 0);
    fb2 = await connectChannel(actors.owner, 'facebook_page', 1);
    ig = await connectChannel(actors.owner, 'instagram', 0);
  });
  afterAll(async () => {
    await t.close();
  });

  const approveBody = (post: PostBody, at = inMinutes(120)) => ({
    expectedVersion: post.version,
    scheduledAt: at,
  });

  it('duyệt bài hai kênh → approved + đúng 2 mục scheduled + 2 việc publish; ghi người duyệt', async () => {
    const post = await createDraft(actors.owner, [{ connectionId: fb }, { connectionId: fb2 }]);
    const res = await actors.owner.post(`${P}/${post.id}/approve`, approveBody(post));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const approved = res.body as PostBody & { approvedBy: string };
    expect(approved.status).toBe('approved');
    expect(approved.version).toBe(post.version + 1);
    expect(approved.approvedBy).toBeTruthy();
    const attempts = await attemptsOf(post.id);
    expect(attempts.map((a) => a.status)).toEqual(['scheduled', 'scheduled']);
    expect(await publishJobsOf(await attemptIdsOf(post.id))).toBe(2);
    // Hai kênh khác nhau → hai mục khác kênh.
    expect(new Set(attempts.map((a) => a.channel_connection_id)).size).toBe(2);
  });

  it('gọi lại 20 lần song song → đúng 1 thành công, còn lại POST_ALREADY_APPROVED; vẫn đúng 2 mục / 2 việc', async () => {
    const post = await createDraft(actors.owner, [{ connectionId: fb }, { connectionId: fb2 }]);
    const body = approveBody(post);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => actors.owner.post(`${P}/${post.id}/approve`, body)),
    );
    const ok = results.filter((r) => r.status === 200);
    const dup = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(1);
    expect(dup).toHaveLength(19);
    for (const r of dup) {
      expect((r.body as ErrorResponse).error.code).toBe('POST_ALREADY_APPROVED');
    }
    expect(await attemptsOf(post.id)).toHaveLength(2);
    expect(await publishJobsOf(await attemptIdsOf(post.id))).toBe(2);
  });

  it('duyệt trên phiên bản cũ của bài đã đổi nội dung → VERSION_CONFLICT, không duyệt nhầm bản', async () => {
    const post = await createDraft(actors.owner, [{ connectionId: fb }]);
    await actors.owner.put(`${P}/${post.id}`, {
      expectedVersion: post.version,
      sharedText: 'Nội dung đã đổi',
      variants: [{ connectionId: fb, customized: false, text: '', hashtags: [], media: [] }],
    });
    const res = await actors.owner.post(`${P}/${post.id}/approve`, approveBody(post));
    expectError(res, 409, 'VERSION_CONFLICT');
    expect(await attemptsOf(post.id)).toEqual([]);
  });

  it('giờ quá gần (now + 2 phút) → 422 TIME_IN_PAST kèm giờ gợi ý; đúng ranh giới chấp nhận', async () => {
    const post = await createDraft(actors.owner, [{ connectionId: fb }]);
    const bad = await actors.owner.post(`${P}/${post.id}/approve`, approveBody(post, inMinutes(2)));
    const error = expectError(bad, 422, 'TIME_IN_PAST');
    const suggested = (error.extra as { suggestedAt?: string } | undefined)?.suggestedAt;
    expect(suggested).toBeTruthy();
    expect(new Date(suggested ?? 0).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    expect(await attemptsOf(post.id)).toEqual([]);
    const ok = await actors.owner.post(`${P}/${post.id}/approve`, approveBody(post, inMinutes(6)));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('một kênh đã ngắt → 409 CHANNEL_INACTIVE kèm channelIssues, KHÔNG mục nào được tạo (tất cả hoặc không)', async () => {
    const dead = await connectChannel(actors.owner, 'instagram', 1);
    const post = await createDraft(actors.owner, [{ connectionId: fb }, { connectionId: dead }]);
    expect((await actors.owner.delete(`/api/v1/channels/${dead}`)).status).toBe(204);
    const res = await actors.owner.post(`${P}/${post.id}/approve`, approveBody(post));
    const error = expectError(res, 409, 'CHANNEL_INACTIVE');
    const issues = (
      error.extra as { channelIssues: { connectionId: string; remedies: unknown[] }[] }
    ).channelIssues;
    expect(issues.map((i) => i.connectionId)).toEqual([dead]);
    expect(issues[0]?.remedies.length).toBeGreaterThanOrEqual(1);
    expect(await attemptsOf(post.id)).toEqual([]);
    const after = await actors.owner.get(`${P}/${post.id}`);
    expect((after.body as { post: { status: string } }).post.status).toBe('draft');
  });

  it('Instagram thiếu media → 422 POST_CONTENT_INVALID theo kênh; bài giữ nguyên Nháp', async () => {
    const post = await createDraft(actors.owner, [{ connectionId: fb }, { connectionId: ig }]);
    const res = await actors.owner.post(`${P}/${post.id}/approve`, approveBody(post));
    const error = expectError(res, 422, 'POST_CONTENT_INVALID');
    const ids = (error.extra as { channelIssues: { connectionId: string }[] }).channelIssues.map(
      (i) => i.connectionId,
    );
    expect(ids).toContain(ig);
    expect(ids).not.toContain(fb);
    expect(await attemptsOf(post.id)).toEqual([]);
  });

  it('cộng tác viên duyệt → 403; chưa đăng nhập → 401', async () => {
    const post = await createDraft(actors.owner, [{ connectionId: fb }]);
    expect(
      (await actors.collaborator.post(`${P}/${post.id}/approve`, approveBody(post))).status,
    ).toBe(403);
    expect((await actors.anonymous.post(`${P}/${post.id}/approve`, approveBody(post))).status).toBe(
      401,
    );
  });

  it('bài của tài khoản khác → 404', async () => {
    const post = await createDraft(actors.owner, [{ connectionId: fb }]);
    const other = await registerAndVerify(t, {});
    const res = await other.agent.post(`${P}/${post.id}/approve`, approveBody(post));
    expectError(res, 404, 'NOT_FOUND');
  });

  describe('hạn mức kênh', () => {
    it('hai bài khác nhau vượt max_posts_per_24h của kênh → bài vượt bị CHANNEL_QUOTA_EXCEEDED, không mục nào', async () => {
      await asOwner((c) =>
        c.query(
          "UPDATE content.channel_rules SET max_posts_per_24h = 1 WHERE channel_type = 'facebook_page'",
        ),
      );
      try {
        // Cache giới hạn 5 phút trong tiến trình: đặt lại bằng cách dùng kênh mới + giờ riêng.
        const { resetChannelRulesCache } =
          await import('../../src/modules/content/internal/channel-rules');
        resetChannelRulesCache();
        // Tài khoản riêng để kênh chưa có mục nào (hạn mức tính theo kênh).
        const solo = await registerAndVerify(t, {});
        const chan = await connectChannel(solo.agent, 'facebook_page', 0);
        const a = await createDraft(solo.agent, [{ connectionId: chan }]);
        const b = await createDraft(solo.agent, [{ connectionId: chan }]);
        const at = inMinutes(600);
        const [ra, rb] = await Promise.all([
          solo.agent.post(`${P}/${a.id}/approve`, approveBody(a, at)),
          solo.agent.post(`${P}/${b.id}/approve`, approveBody(b, at)),
        ]);
        const statuses = [ra.status, rb.status].sort();
        expect(statuses).toEqual([200, 409]);
        const loser = ra.status === 409 ? ra : rb;
        expectError(loser, 409, 'CHANNEL_QUOTA_EXCEEDED');
        const total = await asOwner(async (c) => {
          const r = await c.query<{ n: string }>(
            "SELECT count(*)::text AS n FROM publishing.publish_attempts WHERE channel_connection_id = $1 AND status <> 'cancelled'",
            [chan],
          );
          return Number(r.rows[0]?.n);
        });
        expect(total).toBe(1);
      } finally {
        await asOwner((c) =>
          c.query(
            "UPDATE content.channel_rules SET max_posts_per_24h = NULL WHERE channel_type = 'facebook_page'",
          ),
        );
        const { resetChannelRulesCache } =
          await import('../../src/modules/content/internal/channel-rules');
        resetChannelRulesCache();
      }
    });
  });

  describe('gợi ý giờ', () => {
    it('trả đúng số giờ khác nhau, đều ≥ now + 5 phút', async () => {
      const res = await actors.owner.post('/api/v1/approvals/suggest-times', { count: 7 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const times = (res.body as { times: string[] }).times;
      expect(times).toHaveLength(7);
      expect(new Set(times).size).toBe(7);
      for (const time of times) {
        expect(new Date(time).getTime()).toBeGreaterThanOrEqual(Date.now() + 4 * 60_000);
      }
      expect(
        (await actors.owner.post('/api/v1/approvals/suggest-times', { count: 101 })).status,
      ).toBe(400);
    });
  });
});
