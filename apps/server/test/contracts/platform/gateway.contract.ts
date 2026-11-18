import { describe, expect, it } from 'vitest';
import {
  ConnectionNotFoundError,
  InvalidRequestError,
  validateMedia,
  type ChannelType,
  type PlatformGatewayPublicApi,
} from '../../../src/modules/platform_gateway';
import type { PlatformHarness } from './harness';

// Bộ kiểm thử hợp đồng TẦNG CỔNG (005, contracts/platform-gateway.md mục 5): 8 kịch bản US1, kết nối
// khác tài khoản, không lộ mã quyền, luồng kết nối. Chạy với `memory` (pnpm test) và `sandbox` (test:db).

const HOUR = 3_600_000;
const win = () => ({ from: new Date(Date.now() - HOUR), to: new Date(Date.now() + 60_000) });

export function describePlatformGatewayContract(harness: () => PlatformHarness): void {
  const gw = (timeout?: number): PlatformGatewayPublicApi => harness().gateway(timeout);
  const inA = <T>(fn: () => Promise<T>) => harness().as(harness().a, fn);
  const text = (tag: string) => `POST_CANARY_${tag} Khai trương ưu đãi 20% https://example.vn/km`;

  async function connect(type: ChannelType, opts?: { status?: 'disconnected' }) {
    return harness().createConnection(type, opts);
  }

  async function submit(g: PlatformGatewayPublicApi, connectionId: string, t: string) {
    const conn = await g.getConnection(connectionId);
    return g.submit({
      connectionId,
      text: t,
      media: [],
      contentHash: g.contentHash(conn!.channelType, t),
    });
  }

  describe('US1 – luồng đăng trên hợp đồng', () => {
    it('AS1: hết thời gian SAU khi lên → failed/unknown → reconcile found, publishedCount = 1', async () => {
      await inA(async () => {
        const g = gw(150);
        const id = await connect('facebook_page');
        await harness().script(`connection:${id}`, [{ submit: 'timeout_after_publish' }]);
        const t = text('as1');
        const r = await submit(g, id, t);
        expect(r).toMatchObject({ kind: 'failed', error: { category: 'unknown' } });
        const hash = g.contentHash('facebook_page', t);
        expect(await g.reconcile({ connectionId: id, contentHash: hash, ...win() })).toMatchObject({
          kind: 'found',
        });
        expect(await harness().publishedCount(hash)).toBe(1);
      });
    });

    it('AS2: hết thời gian TRƯỚC khi lên → not_found; gửi lại 1 lần → publishedCount = 1', async () => {
      await inA(async () => {
        const g = gw(150);
        const id = await connect('facebook_page');
        await harness().script(`connection:${id}`, [{ submit: 'timeout_before_publish' }]);
        const t = text('as2');
        const hash = g.contentHash('facebook_page', t);
        expect(await submit(g, id, t)).toMatchObject({
          kind: 'failed',
          error: { category: 'unknown' },
        });
        expect(await g.reconcile({ connectionId: id, contentHash: hash, ...win() })).toEqual({
          kind: 'not_found',
        });
        expect(await submit(g, id, t)).toMatchObject({ kind: 'published' });
        expect(await harness().publishedCount(hash)).toBe(1);
      });
    });

    it('AS3: kênh không đối soát được (Zalo) → unsupported/capability', async () => {
      await inA(async () => {
        const g = gw();
        const id = await connect('zalo_oa');
        expect(g.capabilities('zalo_oa').reconcile).toBe(false);
        expect(await g.reconcile({ connectionId: id, contentHash: 'ch1:x', ...win() })).toEqual({
          kind: 'unsupported',
          reason: 'capability',
        });
      });
    });

    it('AS4: phân loại 3 loại lỗi + mã lạ → unknown', async () => {
      await inA(async () => {
        const g = gw();
        const id = await connect('facebook_page');
        const cases = [
          ['FAKE_RATE_LIMIT', 'transient', 'retry_later'],
          ['FAKE_TOKEN_EXPIRED', 'user_action', 'reconnect'],
          ['FAKE_MEDIA_REJECTED', 'user_action', 'edit_media'],
          ['FAKE_TEXT_TOO_LONG', 'user_action', 'edit_text'],
          ['FAKE_SERVER_ERROR_AFTER_SEND', 'unknown', 'check_on_platform'],
          ['MA_LA_CHUA_GAP', 'unknown', 'check_on_platform'],
        ] as const;
        for (const [code, category, remedy] of cases) {
          await harness().script(`connection:${id}`, [{ submit: { fail: code } }]);
          const r = await submit(g, id, text(code));
          expect(r, code).toMatchObject({ kind: 'failed', error: { category, rawCode: code } });
          if (r.kind === 'failed') {
            expect(r.error.remedies.map((x) => x.action)).toContain(remedy);
            expect(r.error.messageVi.length).toBeGreaterThan(0);
            if (code === 'FAKE_RATE_LIMIT') expect(r.error.retryAfterSec).toBe(60);
          }
        }
        expect(g.classifyError('facebook_page', 'MA_LA')).toMatchObject({ category: 'unknown' });
      });
    });

    it('AS5: Instagram processing → checkStatus processing → done / failed', async () => {
      await inA(async () => {
        const g = gw();
        const id = await connect('instagram');
        expect(g.capabilities('instagram').asyncProcessing).toBe(true);
        for (const [mode, end] of [
          ['processing_then_done', 'done'],
          ['processing_then_failed', 'failed'],
        ] as const) {
          await harness().script(`connection:${id}`, [{ submit: mode }]);
          const r = await submit(g, id, text(mode));
          expect(r.kind).toBe('processing');
          if (r.kind !== 'processing') return;
          expect(await g.checkStatus(id, r.processingId)).toEqual({ kind: 'processing' });
          expect(await g.checkStatus(id, r.processingId)).toMatchObject({ kind: end });
        }
      });
    });

    it('AS6: mediaRules + validateMedia có vi phạm tiếng Việt', async () => {
      await inA(async () => {
        const g = gw();
        const id = await connect('zalo_oa');
        const { channelType, rules } = await g.mediaRules(id);
        expect(channelType).toBe('zalo_oa');
        const v = validateMedia(rules, [
          {
            mediaId: 'm1',
            kind: 'video',
            format: 'mp4',
            bytes: 1,
            width: 1,
            height: 1,
            durationSec: 1,
          },
        ]);
        expect(v.length).toBeGreaterThan(0);
        expect(v[0]?.messageVi).toMatch(/video/);
      });
    });

    it('AS7: refreshToken ok / user_action reconnect', async () => {
      await inA(async () => {
        const g = gw();
        const id = await connect('facebook_page');
        await harness().script(`connection:${id}`, [{ refresh: 'ok' }, { refresh: 'fail' }]);
        expect(await g.refreshToken(id)).toMatchObject({ kind: 'refreshed' });
        const failed = await g.refreshToken(id);
        expect(failed).toMatchObject({ kind: 'failed', error: { category: 'user_action' } });
        if (failed.kind === 'failed') expect(failed.error.remedies[0].action).toBe('reconnect');
      });
    });

    it('AS8: checkAccount eligible / ineligible user_action', async () => {
      await inA(async () => {
        const g = gw();
        const id = await connect('instagram');
        expect(await g.checkAccount(id)).toMatchObject({ kind: 'eligible' });
        await harness().script(`connection:${id}`, [{ check: 'not_professional' }]);
        expect(await g.checkAccount(id)).toMatchObject({
          kind: 'ineligible',
          error: { category: 'user_action' },
        });
      });
    });
  });

  describe('bất biến của tầng cổng', () => {
    it('chữ "đổi nhẹ" khi lưu vẫn found', async () => {
      await inA(async () => {
        const g = gw();
        const id = await connect('facebook_page');
        for (const how of ['shorten_links', 'nfd', 'whitespace'] as const) {
          await harness().script(`connection:${id}`, [{ alterStoredText: how }]);
          const t = text(`alter_${how}`) + ' Phở Hà Nội';
          await submit(g, id, t);
          expect(
            await g.reconcile({
              connectionId: id,
              contentHash: g.contentHash('facebook_page', t),
              ...win(),
            }),
            how,
          ).toMatchObject({ kind: 'found' });
        }
      });
    });

    it('khoảng đối soát quá lớn → window_too_large; from > to → InvalidRequestError', async () => {
      await inA(async () => {
        const g = gw();
        const id = await connect('facebook_page');
        const to = new Date();
        expect(
          await g.reconcile({
            connectionId: id,
            contentHash: 'ch1:x',
            from: new Date(to.getTime() - 169 * HOUR),
            to,
          }),
        ).toEqual({ kind: 'unsupported', reason: 'window_too_large' });
        await expect(
          g.reconcile({
            connectionId: id,
            contentHash: 'ch1:x',
            from: to,
            to: new Date(to.getTime() - 1),
          }),
        ).rejects.toBeInstanceOf(InvalidRequestError);
      });
    });

    it('contentHash không khớp chữ → InvalidRequestError', async () => {
      await inA(async () => {
        const g = gw();
        const id = await connect('facebook_page');
        await expect(
          g.submit({ connectionId: id, text: 'a', media: [], contentHash: 'ch1:sai' }),
        ).rejects.toBeInstanceOf(InvalidRequestError);
      });
    });

    it('kết nối của tài khoản khác / không tồn tại → cùng ConnectionNotFoundError', async () => {
      const h = harness();
      const idB = await h.as(h.b, () => connect('facebook_page'));
      await inA(async () => {
        const g = gw();
        for (const id of [idB, '01900000-0000-7000-8000-000000000000', 'không-phải-uuid']) {
          await expect(g.checkAccount(id)).rejects.toBeInstanceOf(ConnectionNotFoundError);
          await expect(g.mediaRules(id)).rejects.toBeInstanceOf(ConnectionNotFoundError);
          expect(await g.getConnection(id)).toBeNull();
        }
      });
    });

    it('kết nối đã ngắt → failed/user_action reconnect, không gọi nền tảng', async () => {
      await inA(async () => {
        const g = gw();
        const id = await connect('facebook_page', { status: 'disconnected' });
        const t = text('disc');
        const r = await submit(g, id, t);
        expect(r).toMatchObject({ kind: 'failed', error: { category: 'user_action' } });
        if (r.kind === 'failed') expect(r.error.remedies[0].action).toBe('reconnect');
        expect(await harness().publishedCount(g.contentHash('facebook_page', t))).toBe(0);
      });
    });

    it('hai submit cùng dấu → publishedCount = 2 (bản giả lập không che đăng trùng)', async () => {
      await inA(async () => {
        const g = gw();
        const id = await connect('facebook_page');
        const t = text('dup');
        await submit(g, id, t);
        await submit(g, id, t);
        expect(await harness().publishedCount(g.contentHash('facebook_page', t))).toBe(2);
      });
    });

    it('kết quả và nhật ký không có mã quyền hay nội dung bài', async () => {
      await inA(async () => {
        const g = gw();
        const id = await connect('facebook_page');
        const out = JSON.stringify([
          await g.getConnection(id),
          await g.checkAccount(id),
          await submit(g, id, text('leak')),
        ]);
        expect(out).not.toMatch(/fake_tok_|POST_CANARY_/);
      });
      expect(harness().logText()).not.toMatch(/fake_tok_|POST_CANARY_/);
    });
  });

  describe('luồng kết nối kênh', () => {
    const redirect = 'http://app.test/api/v1/channels/callback/facebook_page';
    const stateOf = (url: string) => new URL(url, 'http://x').searchParams.get('state')!;

    it('đủ luồng: state → phiên chọn (2 đủ điều kiện + 1 không) → lưu; chọn lại → kết nối có sẵn', async () => {
      await inA(async () => {
        const c = harness().connections();
        const { authorizeUrl } = await c.startConnect('facebook_page', redirect);
        const out = await c.handleCallback('facebook_page', {
          state: stateOf(authorizeUrl),
          code: 'fake_code_1',
        });
        expect(out.kind).toBe('selection');
        if (out.kind !== 'selection') return;
        const sel = await c.getSelection(out.selectionId);
        // Hợp đồng 010: ứng viên có `selectable` + `blocked` (lý do + cách khắc phục), không còn `check` thô.
        expect(sel.candidates.map((x) => x.selectable)).toEqual([true, true, false]);
        expect(sel.candidates[2]?.blocked?.code).toBe('NOT_PROFESSIONAL');
        expect(sel.candidates[2]?.blocked?.remedies.length).toBeGreaterThanOrEqual(1);
        expect(sel.remainingSlots).toBeGreaterThan(0);
        expect(JSON.stringify(sel)).not.toContain('fake_tok_');
        const first = await c.saveConnection(out.selectionId, sel.candidates[0]!.externalId);
        expect(first.created).toBe(true);
        expect(JSON.stringify(first)).not.toContain('fake_tok_');

        const again = await c.startConnect('facebook_page', redirect);
        const out2 = await c.handleCallback('facebook_page', {
          state: stateOf(again.authorizeUrl),
          code: 'fake_code_2',
        });
        if (out2.kind !== 'selection') throw new Error('mong đợi phiên chọn');
        // Ứng viên không đủ điều kiện → không lưu được (phiên chọn vẫn còn dùng được).
        await expect(
          c.saveConnection(out2.selectionId, sel.candidates[2]!.externalId),
        ).rejects.toMatchObject({ code: 'CHANNEL_INELIGIBLE' });
        const dup = await c.saveConnection(out2.selectionId, sel.candidates[0]!.externalId);
        expect(dup).toMatchObject({
          created: false,
          connection: { connectionId: first.connection.connectionId },
        });
      });
    });

    it('state sai / đã dùng / khác loại kênh / khác tài khoản → STATE_INVALID; hủy → CONNECT_CANCELLED', async () => {
      const h = harness();
      const c = h.connections();
      const started = await h.as(h.a, () => c.startConnect('facebook_page', redirect));
      const state = stateOf(started.authorizeUrl);
      // Tài khoản khác dùng state của A.
      expect(
        await h.as(h.b, () => c.handleCallback('facebook_page', { state, code: 'fake_code_x' })),
      ).toEqual({
        kind: 'error',
        code: 'STATE_INVALID',
      });
      await inA(async () => {
        expect(
          await c.handleCallback('facebook_page', { state: 'sai', code: 'fake_code_x' }),
        ).toEqual({
          kind: 'error',
          code: 'STATE_INVALID',
        });
        expect(await c.handleCallback('instagram', { state, code: 'fake_code_x' })).toEqual({
          kind: 'error',
          code: 'STATE_INVALID',
        });
        // state đã bị lượt trên tiêu → dùng lại → STATE_INVALID.
        expect(await c.handleCallback('facebook_page', { state, code: 'fake_code_x' })).toEqual({
          kind: 'error',
          code: 'STATE_INVALID',
        });
        const s2 = await c.startConnect('facebook_page', redirect);
        expect(
          await c.handleCallback('facebook_page', {
            state: stateOf(s2.authorizeUrl),
            error: 'access_denied',
          }),
        ).toEqual({ kind: 'error', code: 'CONNECT_CANCELLED' });
      });
    });

    it('danh sách Page giả theo kịch bản target=oauth', async () => {
      await inA(async () => {
        const c = harness().connections();
        await harness().setOauthPages([
          { externalId: 'p-x', displayName: 'Trang X', eligible: true },
        ]);
        const s = await c.startConnect('facebook_page', redirect);
        const out = await c.handleCallback('facebook_page', {
          state: stateOf(s.authorizeUrl),
          code: 'fake_code_1',
        });
        if (out.kind !== 'selection') throw new Error('mong đợi phiên chọn');
        expect((await c.getSelection(out.selectionId)).candidates.map((x) => x.externalId)).toEqual(
          ['p-x'],
        );
      });
    });
  });
}
