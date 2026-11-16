// T026, T051, T087–T089, T027 (012) – ma trận quyền, cô lập tài khoản, phủ kiểm toán, không rò nội dung bài,
// không đụng Cổng AI. ApiAppModule THẬT, kho sandbox (hàng chờ `notify` thật).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QueueLifecycle } from '../../src/modules/queue';
import { createActors, type Actors } from '../auth/helpers/actors';
import { createTestApp, registerAndVerify, type Agent, type TestApp } from '../auth/helpers/app';
import { asOwner, describeDb } from '../db/helpers/db';
import { jobs } from '../queue/helpers/queue-db';
import { connectChannel, createDraft, inMinutes, P, type PostBody } from './helpers/posts';

const SECRET = 'NỘI-DUNG-BÍ-MẬT-CỦA-KHÁCH-ZXQ-91';

describeDb('Bảo mật bài viết, duyệt, lịch (012)', () => {
  let t: TestApp;
  let actors: Actors;
  let fb: string;

  beforeAll(async () => {
    t = await createTestApp({ env: { FAKE_STATE_STORE: 'sandbox' } });
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    actors = await createActors(t);
    fb = await connectChannel(actors.owner, 'facebook_page', 0);
  });
  afterAll(async () => {
    await t.close();
  });

  const id = '01a1e2c3-0000-7000-8000-000000000001';
  type Call = (agent: Agent) => Promise<{ status: number }>;
  /** [mô tả, gọi, chỉ chủ?] – thân cố ý sai: lớp quyền chạy TRƯỚC kiểm tra đầu vào. */
  const endpoints: [string, Call, boolean][] = [
    ['POST /posts', (a) => a.post(P, {}), false],
    ['GET /posts', (a) => a.get(P), false],
    ['GET /posts/:id', (a) => a.get(`${P}/${id}`), false],
    ['PUT /posts/:id', (a) => a.put(`${P}/${id}`, {}), false],
    ['DELETE /posts/:id', (a) => a.delete(`${P}/${id}?expectedVersion=1`), false],
    ['GET /posts/:id/history', (a) => a.get(`${P}/${id}/history`), false],
    ['GET /channel-rules', (a) => a.get('/api/v1/channel-rules'), false],
    ['GET /calendar', (a) => a.get('/api/v1/calendar'), false],
    ['POST /posts/submit', (a) => a.post(`${P}/submit`, {}), false],
    ['POST /posts/:id/withdraw', (a) => a.post(`${P}/${id}/withdraw`, {}), false],
    ['PUT /posts/:id/schedule', (a) => a.put(`${P}/${id}/schedule`, {}), false],
    ['POST /approvals/suggest-times', (a) => a.post('/api/v1/approvals/suggest-times', {}), false],
    ['POST /posts/:id/approve', (a) => a.post(`${P}/${id}/approve`, {}), true],
    ['POST /approvals/approve-batch', (a) => a.post('/api/v1/approvals/approve-batch', {}), true],
    ['POST /posts/:id/return', (a) => a.post(`${P}/${id}/return`, {}), true],
    ['POST /approvals/return-batch', (a) => a.post('/api/v1/approvals/return-batch', {}), true],
    ['POST /posts/:id/unschedule', (a) => a.post(`${P}/${id}/unschedule`, {}), true],
    ['GET /approvals/pending', (a) => a.get('/api/v1/approvals/pending'), true],
    ['GET /approvals/pending/count', (a) => a.get('/api/v1/approvals/pending/count'), true],
  ];

  describe('ma trận quyền (T088)', () => {
    it.each(endpoints)('%s', async (_name, call, ownerOnly) => {
      expect((await call(actors.anonymous)).status).toBe(401);
      const collaborator = (await call(actors.collaborator)).status;
      if (ownerOnly) expect(collaborator).toBe(403);
      else expect([401, 403]).not.toContain(collaborator);
      expect([401, 403]).not.toContain((await call(actors.owner)).status);
    });

    it('mọi điểm cuối của 012 đã khai báo quyền (không có ACCESS_NOT_DECLARED)', async () => {
      for (const [, call] of endpoints) {
        const res = (await call(actors.owner)) as {
          status: number;
          body?: { error?: { code?: string } };
        };
        expect(res.body?.error?.code).not.toBe('ACCESS_NOT_DECLARED');
      }
    });
  });

  describe('cô lập tài khoản (T026, T051)', () => {
    it('B không duyệt/trả/hủy lịch/đổi giờ/rút/xem bài của A; danh sách chờ duyệt của B rỗng', async () => {
      const mine = await createDraft(actors.owner, [{ connectionId: fb }]);
      const other = await registerAndVerify(t, { displayName: 'Cửa hàng B' });
      const v = { expectedVersion: mine.version };
      const calls: Promise<{ status: number }>[] = [
        other.agent.post(`${P}/${mine.id}/approve`, { ...v, scheduledAt: inMinutes(200) }),
        other.agent.post(`${P}/${mine.id}/return`, { ...v, note: 'x' }),
        other.agent.post(`${P}/${mine.id}/unschedule`, v),
        other.agent.post(`${P}/${mine.id}/withdraw`, v),
        other.agent.put(`${P}/${mine.id}/schedule`, { ...v, scheduledAt: inMinutes(200) }),
        other.agent.get(`${P}/${mine.id}`),
        other.agent.get(`${P}/${mine.id}/history`),
      ];
      for (const res of await Promise.all(calls)) expect(res.status).toBe(404);
      const batch = await other.agent.post('/api/v1/approvals/approve-batch', {
        items: [{ postId: mine.id, expectedVersion: mine.version, scheduledAt: inMinutes(200) }],
      });
      expect(batch.body).toMatchObject({ succeeded: 0, failed: 1 });
      expect(
        (batch.body as { results: { error: { code: string } }[] }).results[0]?.error.code,
      ).toBe('NOT_FOUND');
      const pending = await other.agent.get('/api/v1/approvals/pending');
      expect((pending.body as { items: unknown[] }).items).toEqual([]);
      const list = await other.agent.get(P);
      expect((list.body as { items: unknown[] }).items).toEqual([]);
      const cal = await other.agent.get(
        `/api/v1/calendar?from=${new Date().toISOString()}&to=${new Date(Date.now() + 30 * 86_400_000).toISOString()}`,
      );
      expect((cal.body as { items: unknown[] }).items).toEqual([]);
      // Bài của A không đổi.
      const after = (await actors.owner.get(`${P}/${mine.id}`)).body as { post: PostBody };
      expect(after.post).toMatchObject({ status: 'draft', version: mine.version });
    });
  });

  describe('kiểm toán và không rò nội dung (T087, T089)', () => {
    it('mỗi thao tác ghi kiểm toán có trace_id; metadata chỉ mã; nội dung bài không nằm ở nhật ký/việc/thông báo/lịch sử', async () => {
      const post = await createDraft(actors.collaborator, [{ connectionId: fb }], {
        sharedText: SECRET,
        scheduledAt: inMinutes(300),
        internalName: 'Bài kiểm toán',
      });
      const submit = await actors.collaborator.post(`${P}/submit`, {
        items: [{ postId: post.id, expectedVersion: post.version }],
      });
      expect((submit.body as { succeeded: number }).succeeded).toBe(1);
      let cur = (await actors.owner.get(`${P}/${post.id}`)).body as { post: PostBody };
      const approved = await actors.owner.post(`${P}/${post.id}/approve`, {
        expectedVersion: cur.post.version,
        scheduledAt: inMinutes(320),
      });
      expect(approved.status).toBe(200);
      cur = { post: approved.body as PostBody };
      const rescheduled = await actors.owner.put(`${P}/${post.id}/schedule`, {
        expectedVersion: cur.post.version,
        scheduledAt: inMinutes(340),
      });
      cur = { post: rescheduled.body as PostBody };
      const unscheduled = await actors.owner.post(`${P}/${post.id}/unschedule`, {
        expectedVersion: cur.post.version,
      });
      cur = { post: unscheduled.body as PostBody };
      const resubmitted = await actors.collaborator.post(`${P}/submit`, {
        items: [{ postId: post.id, expectedVersion: cur.post.version }],
      });
      expect((resubmitted.body as { succeeded: number }).succeeded).toBe(1);
      cur = (await actors.owner.get(`${P}/${post.id}`)).body as { post: PostBody };
      const returned = await actors.owner.post(`${P}/${post.id}/return`, {
        expectedVersion: cur.post.version,
        note: 'Ghi chú của chủ',
      });
      cur = { post: returned.body as PostBody };
      expect(
        (await actors.collaborator.delete(`${P}/${post.id}?expectedVersion=${cur.post.version}`))
          .status,
      ).toBe(204);

      const audit = await asOwner(
        async (c) =>
          (
            await c.query<{
              action: string;
              trace_id: string | null;
              actor_type: string;
              metadata: Record<string, unknown>;
            }>(
              "SELECT action, trace_id, actor_type, metadata FROM infra.audit_log WHERE metadata->>'postId' = $1 ORDER BY occurred_at",
              [post.id],
            )
          ).rows,
      );
      const actions = audit.map((a) => a.action);
      for (const expected of [
        'post.submit',
        'post.approve',
        'post.reschedule',
        'post.unschedule',
        'post.return',
        'post.delete_draft',
      ]) {
        expect(actions, expected).toContain(expected);
      }
      const allowedKeys = new Set(['postId', 'fromVersion', 'toVersion', 'submissionId', 'count']);
      for (const row of audit) {
        expect(row.trace_id, row.action).toBeTruthy();
        expect(row.actor_type).toBe('user');
        for (const key of Object.keys(row.metadata))
          expect(allowedKeys.has(key), `${row.action}.${key}`).toBe(true);
      }

      // Nội dung bài không xuất hiện ở: nhật ký kỹ thuật, dữ liệu việc (publish, notify), kiểm toán, lịch sử.
      expect(t.rawLogs.join('\n')).not.toContain(SECRET);
      const queued = await jobs("name IN ('publish', 'notify')");
      expect(JSON.stringify(queued.map((j) => j.data))).not.toContain(SECRET);
      expect(JSON.stringify(audit)).not.toContain(SECRET);
      const events = await asOwner(
        async (c) =>
          (
            await c.query<{ data: unknown }>(
              'SELECT data FROM content.post_events WHERE post_id = $1',
              [post.id],
            )
          ).rows,
      );
      expect(JSON.stringify(events)).not.toContain(SECRET);
      // Tham số thông báo chỉ có tiêu đề ≤ 60 ký tự (tên nội bộ), không có số tiền.
      const notify = queued.filter((j) => j.data.type === 'notifications.deliver');
      for (const job of notify) {
        const event = (job.data.payload as { event: { params?: { postTitle?: string } } }).event;
        expect((event.params?.postTitle ?? '').length).toBeLessThanOrEqual(60);
      }
    });

    it('không điểm cuối nào trả số tiền hay mã quyền nền tảng', async () => {
      const post = await createDraft(actors.owner, [{ connectionId: fb }]);
      const bodies = JSON.stringify([
        (await actors.owner.get(`${P}/${post.id}`)).body,
        (await actors.owner.get(P)).body,
        (await actors.owner.get('/api/v1/channel-rules')).body,
        (await actors.owner.get('/api/v1/approvals/pending')).body,
      ]);
      expect(bodies).not.toMatch(/usd|micro_usd|cost|accessToken|ciphertext|fake_tok_/i);
    });
  });

  describe('soạn/duyệt không đụng Cổng AI (T027, SC-011, FR-005)', () => {
    it('mã nguồn của content, publishing, approval không nhập ai_gateway hay SDK nhà cung cấp AI', () => {
      const root = resolve('src/modules');
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else if (full.endsWith('.ts')) files.push(full);
        }
      };
      for (const m of ['content', 'publishing', 'approval']) walk(join(root, m));
      expect(files.length).toBeGreaterThan(10);
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        expect(text, file).not.toMatch(/from\s+'[^']*ai_gateway/);
        expect(text, file).not.toMatch(/@anthropic-ai|openai|@google\/genai/);
      }
    });
  });
});
