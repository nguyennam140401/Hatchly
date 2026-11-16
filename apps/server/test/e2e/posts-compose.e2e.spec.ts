// US1 (012, quickstart A) – soạn bài tay theo kênh: tạo nháp nhiều kênh, nội dung riêng từng kênh, kiểm tra
// giới hạn kênh (cảnh báo nhưng vẫn lưu được), lưu lại có khóa phiên bản, cô lập tài khoản. ApiAppModule
// THẬT + kênh giả lập (`pnpm test:db`).
import { ErrorResponse } from '@app/shared/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createActors, type Actors } from '../auth/helpers/actors';
import { createTestApp, registerAndVerify, type TestApp } from '../auth/helpers/app';
import { describeDb } from '../db/helpers/db';
import { connectChannel, createDraft, P, postBody, type PostBody } from './helpers/posts';

function expectError(res: { status: number; body: unknown }, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const parsed = ErrorResponse.safeParse(res.body);
  expect(parsed.success, JSON.stringify(res.body)).toBe(true);
  expect(parsed.data?.error.code).toBe(code);
  return parsed.data!.error;
}

describeDb('Soạn bài tay theo kênh (012 US1)', () => {
  let t: TestApp;
  let actors: Actors;
  let fb: string;
  let ig: string;

  beforeAll(async () => {
    t = await createTestApp();
    actors = await createActors(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it('chưa có kênh hoạt động → 409 NO_ACTIVE_CHANNEL với hành động "Kết nối kênh"', async () => {
    const res = await actors.owner.post(P, postBody([]));
    const error = expectError(res, 409, 'NO_ACTIVE_CHANNEL');
    expect(error.actions.length).toBeGreaterThanOrEqual(1);
  });

  it('tạo nháp hai kênh → 201, version 1, nội dung riêng được giữ, kênh chưa tùy chỉnh dùng chữ chung', async () => {
    fb = await connectChannel(actors.owner, 'facebook_page', 0);
    ig = await connectChannel(actors.owner, 'instagram', 0);
    const created = await createDraft(
      actors.owner,
      [
        { connectionId: fb },
        {
          connectionId: ig,
          customized: true,
          text: 'Bản riêng cho Instagram',
          hashtags: ['aodai'],
        },
      ],
      { internalName: 'Khuyến mãi tuần 47' },
    );
    expect(created).toMatchObject({ status: 'draft', version: 1, source: 'manual' });
    const detail = await actors.owner.get(`${P}/${created.id}`);
    expect(detail.status).toBe(200);
    const body = detail.body as {
      post: {
        title: string;
        variants: {
          connectionId: string;
          customized: boolean;
          text: string;
          hashtags: string[];
          issues: { rule: string }[];
        }[];
      };
      validation: { connectionId: string; issues: { rule: string }[] }[];
      attempts: unknown[];
    };
    expect(body.post.title).toBe('Khuyến mãi tuần 47');
    const igv = body.post.variants.find((v) => v.connectionId === ig);
    expect(igv).toMatchObject({
      customized: true,
      text: 'Bản riêng cho Instagram',
      hashtags: ['aodai'],
    });
    const fbv = body.post.variants.find((v) => v.connectionId === fb);
    expect(fbv).toMatchObject({ customized: false, text: '' });
    // Instagram bắt buộc media: thiếu media → cảnh báo nhưng bài VẪN lưu được.
    expect(igv?.issues.map((i) => i.rule)).toContain('media_required');
    expect(body.validation.map((v) => v.connectionId)).toContain(ig);
    expect(body.attempts).toEqual([]);
  });

  it('sửa nháp đúng expectedVersion → version + 1; lệch phiên bản → VERSION_CONFLICT kèm bài mới nhất', async () => {
    const draft = await createDraft(actors.owner, [{ connectionId: fb }]);
    const saved = await actors.owner.put(`${P}/${draft.id}`, {
      expectedVersion: draft.version,
      ...postBody([{ connectionId: fb }], { sharedText: 'Nội dung đã sửa' }),
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((saved.body as PostBody).version).toBe(2);

    const stale = await actors.owner.put(`${P}/${draft.id}`, {
      expectedVersion: draft.version,
      ...postBody([{ connectionId: fb }], { sharedText: 'Bản của người khác' }),
    });
    const error = expectError(stale, 409, 'VERSION_CONFLICT');
    expect(JSON.stringify(error.extra)).toContain('Nội dung đã sửa');
  });

  it('bản riêng không bị ghi đè khi đổi nội dung chung', async () => {
    const draft = await createDraft(actors.owner, [
      { connectionId: fb },
      { connectionId: ig, customized: true, text: 'Riêng IG' },
    ]);
    const saved = await actors.owner.put(`${P}/${draft.id}`, {
      expectedVersion: draft.version,
      ...postBody(
        [{ connectionId: fb }, { connectionId: ig, customized: true, text: 'Riêng IG' }],
        { sharedText: 'Chung mới' },
      ),
    });
    const post = saved.body as {
      sharedText: string;
      variants: { text: string; customized: boolean }[];
    };
    expect(post.sharedText).toBe('Chung mới');
    expect(post.variants.find((v) => v.customized)?.text).toBe('Riêng IG');
  });

  it('vượt giới hạn chữ Instagram → cảnh báo text_length nhưng vẫn lưu được', async () => {
    const long = 'a'.repeat(2300);
    const draft = await createDraft(actors.owner, [{ connectionId: ig }], { sharedText: long });
    const rules = draft.variants.find((v) => v.connectionId === ig)?.issues.map((i) => i.rule);
    expect(rules).toContain('text_length');
  });

  it('bài hoàn toàn rỗng (không kênh, không chữ) → 422; kênh trùng → 422', async () => {
    const empty = await actors.owner.post(P, { sharedText: '   ', variants: [] });
    expectError(empty, 400, 'VALIDATION_FAILED');
    const dup = await actors.owner.post(P, postBody([{ connectionId: fb }, { connectionId: fb }]));
    expectError(dup, 400, 'VALIDATION_FAILED');
  });

  it('kênh không thuộc tài khoản → 422 POST_CONTENT_INVALID', async () => {
    const res = await actors.owner.post(P, postBody([{ connectionId: crypto.randomUUID() }]));
    expectError(res, 422, 'POST_CONTENT_INVALID');
  });

  it('GET /channel-rules trả bộ giới hạn theo kênh', async () => {
    const res = await actors.collaborator.get('/api/v1/channel-rules');
    expect(res.status).toBe(200);
    const rules = (res.body as { rules: { channelType: string; maxTextLength: number }[] }).rules;
    expect(rules.find((r) => r.channelType === 'instagram')?.maxTextLength).toBe(2200);
    expect(rules.find((r) => r.channelType === 'facebook_page')?.maxTextLength).toBe(63206);
  });

  it('cộng tác viên soạn được; người chưa đăng nhập → 401', async () => {
    const draft = await createDraft(actors.collaborator, [{ connectionId: fb }]);
    expect(draft.status).toBe('draft');
    expect((await actors.anonymous.get(P)).status).toBe(401);
  });

  it('danh sách lọc theo trạng thái và tìm theo từ khóa (thoát % và _)', async () => {
    await createDraft(actors.owner, [{ connectionId: fb }], { sharedText: 'Giảm giá 50% hôm nay' });
    const byKeyword = await actors.owner.get(`${P}?q=${encodeURIComponent('50%')}`);
    expect(byKeyword.status).toBe(200);
    const items = (byKeyword.body as { items: { title: string }[] }).items;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((i) => i.title.includes('50%'))).toBe(true);
    // `%` đơn lẻ không được hiểu là "khớp mọi thứ": bài không chứa ký tự `%` không được trả về.
    await createDraft(actors.owner, [{ connectionId: fb }], { sharedText: 'Bài thuần chữ ZXQ' });
    const wild = await actors.owner.get(`${P}?q=${encodeURIComponent('%')}`);
    const wildTitles = (wild.body as { items: { title: string }[] }).items.map((i) => i.title);
    expect(wildTitles).not.toContain('Bài thuần chữ ZXQ');
    const drafts = await actors.owner.get(`${P}?status=draft&limit=2`);
    expect((drafts.body as { items: unknown[] }).items.length).toBeLessThanOrEqual(2);
  });

  describe('cô lập tài khoản (nguyên tắc I)', () => {
    it('B đọc/sửa/xóa bài của A → 404 NOT_FOUND, không phân biệt "không tồn tại"', async () => {
      const draft = await createDraft(actors.owner, [{ connectionId: fb }]);
      const other = await registerAndVerify(t, { displayName: 'Cửa hàng B' });
      const get = await other.agent.get(`${P}/${draft.id}`);
      const randomGet = await other.agent.get(`${P}/${crypto.randomUUID()}`);
      expectError(get, 404, 'NOT_FOUND');
      expect(get.body).toMatchObject({
        error: { message: (randomGet.body as ErrorResponse).error.message },
      });
      const put = await other.agent.put(`${P}/${draft.id}`, {
        expectedVersion: 1,
        ...postBody([]),
        sharedText: 'tấn công',
      });
      expectError(put, 404, 'NOT_FOUND');
      const del = await other.agent.delete(`${P}/${draft.id}?expectedVersion=1`);
      expectError(del, 404, 'NOT_FOUND');
      // A vẫn thấy nguyên vẹn.
      expect((await actors.owner.get(`${P}/${draft.id}`)).status).toBe(200);
    });

    it('thân yêu cầu có accountId bị từ chối (mã tài khoản chỉ từ phiên)', async () => {
      const res = await actors.owner.post(P, {
        ...postBody([{ connectionId: fb }]),
        accountId: crypto.randomUUID(),
      });
      expectError(res, 400, 'VALIDATION_FAILED');
    });
  });

  describe('xóa nháp', () => {
    it('chủ xóa nháp → 204 và biến mất khỏi danh sách; sai phiên bản → VERSION_CONFLICT', async () => {
      const draft = await createDraft(actors.owner, [{ connectionId: fb }]);
      const stale = await actors.owner.delete(`${P}/${draft.id}?expectedVersion=99`);
      expectError(stale, 409, 'VERSION_CONFLICT');
      const del = await actors.owner.delete(`${P}/${draft.id}?expectedVersion=${draft.version}`);
      expect(del.status).toBe(204);
      expect((await actors.owner.get(`${P}/${draft.id}`)).status).toBe(404);
    });

    it('cộng tác viên không xóa được nháp của người khác → 409 POST_NOT_EDITABLE', async () => {
      const draft = await createDraft(actors.owner, [{ connectionId: fb }]);
      const del = await actors.collaborator.delete(
        `${P}/${draft.id}?expectedVersion=${draft.version}`,
      );
      expectError(del, 409, 'POST_NOT_EDITABLE');
    });
  });
});
