// 005 T026 (contracts/platform-gateway.md mục 3): điểm cuối kết nối kênh trên bản giả lập (kho memory),
// ApiAppModule thật + phiên đăng nhập thật (CSDL kiểm thử – pnpm test:db).
import { ChannelConnectionDto, SelectionResponse } from '@app/shared/platform_gateway';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeDb } from '../db/helpers/db';
import { createActors, type Actors } from '../auth/helpers/actors';
import { createTestApp, type TestApp } from '../auth/helpers/app';

const WEB = 'http://app.test';

describeDb('Kết nối kênh – HTTP (005)', () => {
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
    expect(location.origin + location.pathname).toBe(`${WEB}/channels/connect`);
    const selectionId = location.searchParams.get('selection')!;
    const sel = await actors.owner.get(`/api/v1/channels/selections/${selectionId}`);
    expect(sel.status).toBe(200);
    const body = SelectionResponse.parse(sel.body);
    expect(body.candidates).toHaveLength(3);
    const eligible = body.candidates.find((c) => c.check.kind === 'eligible')!;
    const ineligible = body.candidates.find((c) => c.check.kind === 'ineligible')!;

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
    const sel2 = new URL(cb2.headers.location!).searchParams.get('selection')!;
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
    expect(anon.headers.location).toBe(`${WEB}/channels/connect?error=STATE_INVALID`);

    const wrong = await actors.owner.get(
      '/api/v1/channels/callback/facebook_page?state=sai&code=fake_code_x',
    );
    expect(wrong.headers.location).toBe(`${WEB}/channels/connect?error=STATE_INVALID`);

    const cancelled = await actors.owner.get(
      `/api/v1/channels/callback/facebook_page?state=${encodeURIComponent(state)}&error=access_denied`,
    );
    expect(cancelled.headers.location).toBe(`${WEB}/channels/connect?error=CONNECT_CANCELLED`);
  });
});
