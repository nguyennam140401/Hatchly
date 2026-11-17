// T053 + T054 (013 US5) – điểm cuối Tiến trình đăng trên ApiAppModule THẬT: quyền (chưa đăng nhập 401), cô lập tài khoản (404,
// không lộ tồn tại), người dùng thường KHÔNG BAO GIỜ thấy retry_wait/unknown, hành động theo vai trò, ETag/304, hai yêu cầu
// "Đăng lại" đồng thời chỉ một thắng, và phản hồi KHÔNG chứa dấu nội dung, mã quyền, account_id, mã lỗi gốc.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { QueueLifecycle } from '../../src/modules/queue';
import { createActors, type Actors } from '../auth/helpers/actors';
import { createTestApp, registerAndVerify, type TestApp } from '../auth/helpers/app';
import { asOwner, describeDb } from '../db/helpers/db';
import { jobs } from '../queue/helpers/queue-db';
import { connectChannel } from './helpers/posts';

const TOKEN_LIKE = 'EAAB-SECRET-TOKEN-ZXQ';

describeDb('Tiến trình đăng – HTTP (013)', () => {
  let t: TestApp;
  let actors: Actors;
  let account: string;
  let connectionId: string;

  beforeAll(async () => {
    t = await createTestApp({ env: { FAKE_STATE_STORE: 'sandbox' } });
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    actors = await createActors(t);
    account = actors.ownerMe.account.id;
    connectionId = await connectChannel(actors.owner, 'facebook_page', 0);
  });
  afterAll(async () => {
    await t.close();
  });

  /** Mồi một lượt đăng + nhật ký bước bằng `owner` (đường ghi của Worker đã có kiểm thử riêng). */
  async function seed(
    status: string,
    extra: Record<string, unknown> = {},
    steps: {
      key: string;
      no: number;
      event: string;
      outcome?: string;
      remedies?: unknown;
      msg?: string;
    }[] = [],
  ) {
    const postId = uuidV7();
    const id = uuidV7();
    const cols: Record<string, unknown> = {
      id,
      account_id: account,
      post_id: postId,
      channel_connection_id: connectionId,
      channel_type: 'facebook_page',
      status,
      scheduled_at: new Date(Date.now() + 3_600_000),
      content_version: 2,
      run_no: 1,
      ...extra,
    };
    await asOwner(async (c) => {
      const keys = Object.keys(cols);
      await c.query(
        `INSERT INTO publishing.publish_attempts (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
        keys.map((k) => cols[k]),
      );
      for (const s of steps) {
        await c.query(
          `INSERT INTO publishing.publish_steps (id, account_id, attempt_id, run_no, step_no, step_key, event, outcome, message_vi, remedies, trace_id)
           VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,'t')`,
          [
            uuidV7(),
            account,
            id,
            s.no,
            s.key,
            s.event,
            s.outcome ?? null,
            s.msg ?? null,
            s.remedies === undefined ? null : JSON.stringify(s.remedies),
          ],
        );
      }
    });
    return { postId, id };
  }

  const progress = (postId: string, agent = actors.owner) =>
    agent.get(`/api/v1/posts/${postId}/publish-progress`);

  it('chưa đăng nhập → 401', async () => {
    const { postId, id } = await seed('scheduled');
    expect((await progress(postId, actors.anonymous)).status).toBe(401);
    expect(
      (await actors.anonymous.get(`/api/v1/publish-attempts/${id}/support-details`)).status,
    ).toBe(401);
    expect(
      (await actors.anonymous.post(`/api/v1/publish-attempts/${id}/republish`, { version: 1 }))
        .status,
    ).toBe(401);
    expect(
      (await actors.anonymous.post(`/api/v1/publish-attempts/${id}/mark-published`, { version: 1 }))
        .status,
    ).toBe(401);
  });

  it('lượt lỗi ở bước 2: bước 1 xong, bước 2 lỗi kèm cách sửa, bước 3–5 chưa chạy; có hành động Đăng lại', async () => {
    const { postId } = await seed(
      'needs_user',
      {
        needs_reason: 'media_invalid',
        last_raw_code: 'FB:100',
        last_error_category: 'user_action',
      },
      [
        { key: 'precheck', no: 1, event: 'started' },
        { key: 'precheck', no: 1, event: 'finished', outcome: 'succeeded' },
        { key: 'prepare_media', no: 2, event: 'started' },
        {
          key: 'prepare_media',
          no: 2,
          event: 'finished',
          outcome: 'failed',
          msg: 'Ảnh không phù hợp.',
          remedies: [{ action: 'edit_media', labelVi: 'Chọn ảnh khác' }],
        },
        { key: 'submit', no: 3, event: 'finished', outcome: 'skipped' },
      ],
    );
    const res = await progress(postId);
    expect(res.status).toBe(200);
    const body = res.body as {
      overall: string;
      channels: {
        status: string;
        needsKind: string;
        message: string;
        allowedActions: string[];
        steps: { state: string }[];
      }[];
    };
    expect(body.overall).toBe('needs_action');
    const ch = body.channels[0];
    expect(ch).toMatchObject({
      status: 'needs_action',
      needsKind: 'needs_user',
      message: 'Ảnh không phù hợp.',
    });
    expect(ch?.steps.map((s) => s.state)).toEqual([
      'succeeded',
      'failed',
      'skipped',
      'not_run',
      'not_run',
    ]);
    expect(ch?.allowedActions).toEqual(
      expect.arrayContaining(['republish', 'edit_media', 'contact_support']),
    );
  });

  it('người dùng thường KHÔNG thấy retry_wait/unknown/phase; không lộ dấu nội dung, mã gốc, account_id', async () => {
    const a = await seed('retry_wait', { content_hash: null, last_raw_code: 'FB:NET_BEFORE_SEND' });
    const b = await seed('unknown', {
      phase: 'submitted_awaiting_response',
      content_hash: 'ch1:abcdef',
      submitted_at: new Date(),
      last_raw_code: 'ZZZ:1',
    });
    for (const { postId } of [a, b]) {
      const res = await progress(postId);
      const text = JSON.stringify(res.body);
      expect((res.body as { channels: { status: string }[] }).channels[0]?.status).toBe(
        'publishing',
      );
      for (const banned of [
        'retry_wait',
        'unknown',
        'submitted_awaiting_response',
        'ch1:',
        'content_hash',
        account,
        'ZZZ:1',
        'FB:NET',
        TOKEN_LIKE,
      ]) {
        expect(text, banned).not.toContain(banned);
      }
    }
  });

  it('cộng tác viên: nhận "nhờ chủ kết nối lại", không có reconnect', async () => {
    const { postId } = await seed('needs_user', { needs_reason: 'token_expired' });
    const res = await progress(postId, actors.collaborator);
    const actions =
      (res.body as { channels: { allowedActions: string[] }[] }).channels[0]?.allowedActions ?? [];
    expect(actions).toContain('ask_owner_to_reconnect');
    expect(actions).not.toContain('reconnect');
    const owner = await progress(postId);
    expect(
      (owner.body as { channels: { allowedActions: string[] }[] }).channels[0]?.allowedActions,
    ).toContain('reconnect');
  });

  it('ETag: gửi lại với If-None-Match → 304', async () => {
    const { postId } = await seed('scheduled');
    const first = await progress(postId);
    const etag = first.headers.etag!;
    expect(etag).toMatch(/^"[0-9a-f]{40}"$/);
    const again = await actors.owner.get(`/api/v1/posts/${postId}/publish-progress`, {
      'if-none-match': etag,
    });
    expect(again.status).toBe(304);
    expect(again.text).toBe('');
  });

  it('cô lập tài khoản: người của tài khoản khác không thấy lượt; Đăng lại/Đã đăng/chi tiết → 404', async () => {
    const other = await registerAndVerify(t);
    const { postId, id } = await seed('needs_check', { needs_reason: 'uncertain_result' });
    const res = await progress(postId, other.agent);
    expect(res.status).toBe(200);
    expect((res.body as { channels: unknown[] }).channels).toEqual([]);
    for (const call of [
      other.agent.post(`/api/v1/publish-attempts/${id}/republish`, { version: 1 }),
      other.agent.post(`/api/v1/publish-attempts/${id}/mark-published`, { version: 1 }),
      other.agent.get(`/api/v1/publish-attempts/${id}/support-details`),
    ]) {
      const r = await call;
      expect(r.status).toBe(404);
      expect((r.body as { error: { code: string } }).error.code).toBe('PUBLISH_ATTEMPT_NOT_FOUND');
    }
  });

  it('hai yêu cầu Đăng lại đồng thời → đúng một 200, một 409; chỉ một việc', async () => {
    const { id } = await seed('needs_user', { needs_reason: 'overdue' });
    const version =
      (
        await asOwner((c) =>
          c.query<{ version: number }>(
            'SELECT version FROM publishing.publish_attempts WHERE id = $1',
            [id],
          ),
        )
      ).rows[0]?.version ?? 1;
    const [x, y] = await Promise.all([
      actors.owner.post(`/api/v1/publish-attempts/${id}/republish`, { version }),
      actors.owner.post(`/api/v1/publish-attempts/${id}/republish`, { version }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await jobs("name = 'publish' AND singleton_key = $1", [`publish:${id}`])).toHaveLength(
      1,
    );
    const lose = x.status === 409 ? x : y;
    expect(['PUBLISH_NOT_REPUBLISHABLE', 'PUBLISH_VERSION_CONFLICT']).toContain(
      (lose.body as { error: { code: string } }).error.code,
    );
  });

  it('"Đã đăng" chỉ từ Cần kiểm tra; permalink phải là https; chi tiết hỗ trợ có mã gốc', async () => {
    const wrong = await seed('needs_user', { needs_reason: 'other' });
    const r1 = await actors.owner.post(`/api/v1/publish-attempts/${wrong.id}/mark-published`, {
      version: 1,
    });
    expect([409, 404]).toContain(r1.status);

    const { id } = await seed('needs_check', {
      needs_reason: 'uncertain_result',
      last_raw_code: 'FB:368',
      last_error_category: 'unknown',
    });
    const bad = await actors.owner.post(`/api/v1/publish-attempts/${id}/mark-published`, {
      version: 1,
      permalink: 'http://x.test/p',
    });
    expect(bad.status).toBe(400);
    const details = await actors.owner.get(`/api/v1/publish-attempts/${id}/support-details`);
    expect(details.body).toMatchObject({ attemptId: id, rawCode: 'FB:368' });
    expect(Object.keys(details.body as object)).not.toContain('internalStatus');
    const version =
      (
        await asOwner((c) =>
          c.query<{ version: number }>(
            'SELECT version FROM publishing.publish_attempts WHERE id = $1',
            [id],
          ),
        )
      ).rows[0]?.version ?? 1;
    const ok = await actors.owner.post(`/api/v1/publish-attempts/${id}/mark-published`, {
      version,
      permalink: 'https://facebook.com/p/9',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'published', permalink: 'https://facebook.com/p/9' });
    // Kênh đã đăng không đăng lại được.
    const again = await actors.owner.post(`/api/v1/publish-attempts/${id}/republish`, {
      version: version + 1,
    });
    expect(again.status).toBe(409);
  });
});
