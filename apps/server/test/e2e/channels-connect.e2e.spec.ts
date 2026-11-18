// 005 T026 + 010 T021/T026 (contracts/channels-http-api.md): điểm cuối kết nối kênh trên bản giả lập (kho memory),
// ApiAppModule thật + phiên đăng nhập thật (CSDL kiểm thử – pnpm test:db).
import {
  ChannelConnectionDto,
  ConfirmResponse,
  OverviewResponse,
  SelectionResponse,
} from '@app/shared/platform_gateway';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeDb } from '../db/helpers/db';
import { createActors, type Actors } from '../auth/helpers/actors';
import { createTestApp, type TestApp } from '../auth/helpers/app';

const WEB = 'http://app.test';

describeDb('Kết nối kênh – HTTP (005, 010)', () => {
  let t: TestApp;
  let actors: Actors;

  beforeAll(async () => {
    t = await createTestApp();
    actors = await createActors(t);
  });
  afterAll(async () => {
    await t.close();
  });

  const stateOf = (authorizeUrl: string) => new URL(authorizeUrl, WEB).searchParams.get('state')!;

  async function startState(): Promise<string> {
    const res = await actors.owner.post('/api/v1/channels/connect', {
      channelType: 'facebook_page',
    });
    expect(res.status).toBe(200);
    return stateOf((res.body as { authorizeUrl: string }).authorizeUrl);
  }

  it('cộng tác viên: kết nối/lưu/ngắt → 403; liệt kê → 200', async () => {
    const c = actors.collaborator;
    expect(
      (await c.post('/api/v1/channels/connect', { channelType: 'facebook_page' })).status,
    ).toBe(403);
    expect(
      (await c.post('/api/v1/channels', { selectionId: crypto.randomUUID(), externalId: 'x' }))
        .status,
    ).toBe(403);
    expect((await c.delete(`/api/v1/channels/${crypto.randomUUID()}`)).status).toBe(403);
    expect((await c.get('/api/v1/channels')).status).toBe(200);
  });

  it('đủ luồng: gọi lại → 302 ?selection → chọn → 201; chọn lại → 200; không có mã quyền', async () => {
    const state = await startState();
    const cb = await actors.owner.get(
      `/api/v1/channels/callback/facebook_page?state=${encodeURIComponent(state)}&code=fake_code_abc`,
    );
    expect(cb.status).toBe(302);
    const location = new URL(cb.headers.location!);
    expect(location.origin + location.pathname).toMatch(
      new RegExp(`^${WEB}/channels/select/[0-9a-f-]{36}$`),
    );
    const selectionId = location.pathname.split('/').pop()!;
    const sel = await actors.owner.get(`/api/v1/channels/selections/${selectionId}`);
    expect(sel.status).toBe(200);
    const body = SelectionResponse.parse(sel.body);
    expect(body.candidates).toHaveLength(3);
    expect(body.limit).toBe(5);
    const eligible = body.candidates.find((c) => c.selectable)!;
    const ineligible = body.candidates.find((c) => !c.selectable)!;
    expect(ineligible.blocked?.remedies.length).toBeGreaterThanOrEqual(1);

    const bad = await actors.owner.post('/api/v1/channels', {
      selectionId,
      externalId: ineligible.externalId,
    });
    expect(bad.status).toBe(422);
    expect((bad.body as { error: { code: string } }).error.code).toBe('CHANNEL_INELIGIBLE');

    const saved = await actors.owner.post('/api/v1/channels', {
      selectionId,
      externalId: eligible.externalId,
    });
    expect(saved.status).toBe(201);
    const conn = ChannelConnectionDto.parse(saved.body);

    // Lần hai cùng Page → 200 với kết nối có sẵn.
    const state2 = await startState();
    const cb2 = await actors.owner.get(
      `/api/v1/channels/callback/facebook_page?state=${encodeURIComponent(state2)}&code=fake_code_def`,
    );
    const sel2 = new URL(cb2.headers.location!).pathname.split('/').pop()!;
    const again = await actors.owner.post('/api/v1/channels', {
      selectionId: sel2,
      externalId: eligible.externalId,
    });
    expect(again.status).toBe(200);
    expect(ChannelConnectionDto.parse(again.body).connectionId).toBe(conn.connectionId);

    const list = await actors.collaborator.get('/api/v1/channels');
    const all = JSON.stringify([saved.body, again.body, list.body, sel.body]);
    expect(all).not.toMatch(/fake_tok_|accessToken|ciphertext/i);
    expect((list.body as unknown[]).length).toBeGreaterThanOrEqual(1);

    expect((await actors.owner.delete(`/api/v1/channels/${conn.connectionId}`)).status).toBe(204);
    const after = (await actors.owner.get('/api/v1/channels')).body as {
      connectionId: string;
      status: string;
    }[];
    expect(after.find((c) => c.connectionId === conn.connectionId)?.status).toBe('disconnected');
  });

  it('gọi lại thiếu phiên / sai state → 302 ?error=STATE_INVALID; hủy → CONNECT_CANCELLED', async () => {
    const state = await startState();
    const anon = await actors.anonymous.get(
      `/api/v1/channels/callback/facebook_page?state=${encodeURIComponent(state)}&code=fake_code_x`,
    );
    expect(anon.status).toBe(302);
    expect(anon.headers.location).toBe(`${WEB}/channels?error=STATE_INVALID`);

    const wrong = await actors.owner.get(
      '/api/v1/channels/callback/facebook_page?state=sai&code=fake_code_x',
    );
    expect(wrong.headers.location).toBe(`${WEB}/channels?error=STATE_INVALID`);

    const cancelled = await actors.owner.get(
      `/api/v1/channels/callback/facebook_page?state=${encodeURIComponent(state)}&error=access_denied`,
    );
    expect(cancelled.headers.location).toBe(`${WEB}/channels?error=CONNECT_CANCELLED`);
  });

  it('010: chọn NHIỀU Page một lần → confirm trả kết quả từng Page; overview theo vai trò; phiên chọn bị xóa', async () => {
    const state = await startState();
    const cb = await actors.owner.get(
      `/api/v1/channels/callback/facebook_page?state=${encodeURIComponent(state)}&code=fake_code_multi`,
    );
    const selectionId = new URL(cb.headers.location!).pathname.split('/').pop()!;
    const sel = SelectionResponse.parse(
      (await actors.owner.get(`/api/v1/channels/selections/${selectionId}`)).body,
    );
    const ok = sel.candidates.filter((c) => c.selectable).map((c) => c.externalId);
    const bad = sel.candidates.find((c) => !c.selectable)!.externalId;
    expect(ok.length).toBeGreaterThanOrEqual(2);

    // Cộng tác viên không xác nhận được (API chặn, không chỉ ẩn nút).
    const denied = await actors.collaborator.post(
      `/api/v1/channels/selections/${selectionId}/confirm`,
      { externalIds: ok },
    );
    expect(denied.status).toBe(403);

    const res = await actors.owner.post(`/api/v1/channels/selections/${selectionId}/confirm`, {
      externalIds: [...ok, bad, 'khong-co-trong-phien'],
    });
    expect(res.status).toBe(200);
    const parsed = ConfirmResponse.parse(res.body);
    const outcome = Object.fromEntries(parsed.results.map((r) => [r.externalId, r.outcome]));
    expect(ok.every((id) => outcome[id] === 'created')).toBe(true);
    expect(outcome[bad]).toBe('ineligible');
    expect(outcome['khong-co-trong-phien']).toBe('not_in_selection');
    for (const r of parsed.results) {
      if (r.outcome !== 'created') expect(r.error?.remedies.length).toBeGreaterThanOrEqual(1);
    }

    // Phiên đã dùng/xóa → 404 SELECTION_NOT_FOUND.
    expect((await actors.owner.get(`/api/v1/channels/selections/${selectionId}`)).status).toBe(404);

    // overview: chỉ dữ liệu đã lưu, không mã quyền, không TikTok; chủ thêm được, cộng tác viên chỉ xem.
    const ownerView = await actors.owner.get('/api/v1/channels/overview');
    expect(ownerView.status).toBe(200);
    expect(ownerView.headers['cache-control']).toContain('no-store');
    const ov = OverviewResponse.parse(ownerView.body);
    expect(ov.features.tiktok).toBe(false);
    expect(ov.platforms.map((p) => p.channelType)).toEqual(['facebook_page', 'instagram']);
    expect(ov.viewerCanManage).toBe(true);
    expect(ov.connections.length).toBeGreaterThanOrEqual(ok.length);
    for (const c of ov.connections) {
      expect(c.shortCode).toHaveLength(6);
      expect(c.state).toBe('active');
    }
    const collab = OverviewResponse.parse(
      (await actors.collaborator.get('/api/v1/channels/overview')).body,
    );
    expect(collab.viewerCanManage).toBe(false);
    expect(collab.platforms.every((p) => !p.canAdd)).toBe(true);
    expect(JSON.stringify([parsed, ov, collab])).not.toMatch(/fake_tok_|accessToken|ciphertext/i);
    expect((await actors.anonymous.get('/api/v1/channels/overview')).status).toBe(401);

    // Dọn: ngắt các kết nối vừa tạo.
    for (const c of ov.connections) {
      await actors.owner.delete(`/api/v1/channels/${c.connectionId}`);
    }
  });
});
