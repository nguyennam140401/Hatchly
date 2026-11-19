// 010 T070 (US7, FR-008, FR-017, FR-029, SC-008): kết nối lại giữ nguyên `connectionId`; Page khác ⇒ WRONG_CHANNEL và kênh cũ không đổi;
// ngắt ⇒ xóa hai bản mã cùng giao dịch hủy lượt chưa gửi, idempotent, thu hồi lỗi vẫn xóa phía mình, Instagram phụ thuộc được báo gộp.
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import type { NotificationEvent } from '@app/shared/notifications';
import { executionStorage } from '../../../src/core/context/execution-storage';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import {
  clearAdapters,
  registerAdapter,
} from '../../../src/modules/platform_gateway/internal/adapters/registry';
import type {
  ConnectionCandidate,
  PlatformAdapter,
} from '../../../src/modules/platform_gateway/internal/adapters/adapter';
import {
  registerConnectionConsumers,
  resetConnectionConsumers,
} from '../../../src/modules/platform_gateway/internal/connections/consumers';
import { ConnectionsService } from '../../../src/modules/platform_gateway/internal/connections/connections.service';
import { PgConnectionStore } from '../../../src/modules/platform_gateway/internal/connections/pg-connection-store';
import { FakeCredentialVault } from '../../../src/modules/platform_gateway/internal/vault/credential-vault';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from '../helpers/db';

const REDIRECT = 'https://app.example.test/api/v1/channels/callback/facebook_page';

describeDb('Kết nối lại và ngắt kết nối (dịch vụ + Postgres)', () => {
  let database: TestDatabase;
  let pages: string[] = [];
  let revokeResult: 'done' | 'failed' | 'unsupported' = 'done';
  let revokeCalls = 0;
  let events: NotificationEvent[] = [];
  let cancelledByConsumers = 0;
  let igSource = 'src-page'; // Page nguồn mà ứng viên Instagram khai báo

  const adapter = (channelType: 'facebook_page' | 'instagram'): PlatformAdapter =>
    ({
      channelType,
      authorizeUrl: (state: string) => `https://www.facebook.test/dialog/oauth?state=${state}`,
      exchangeCallback: () =>
        Promise.resolve({
          candidates: pages.map((id): ConnectionCandidate => ({
            externalId: id,
            displayName: `Page ${id}`,
            accessToken: `tok-${id}-${uuidV7().slice(-6)}`,
            refreshToken: 'usr-shared',
            tokenExpiresAt: null,
            expiry: { kind: 'none' },
            ...(channelType === 'instagram' ? { sourceExternalId: igSource } : {}),
          })),
        }),
      checkAccount: () =>
        Promise.resolve({
          kind: 'eligible',
          quotaRemaining: null,
          grantedScopes: ['pages_manage_posts'],
          accountType: null,
          tokenExpiresAt: new Date(Date.now() + 86_400_000),
        }),
      revoke: () => {
        revokeCalls++;
        return Promise.resolve(revokeResult);
      },
    }) as unknown as PlatformAdapter;

  beforeAll(() => {
    database = makeDatabase();
    registerAdapter('facebook_page', () => adapter('facebook_page'));
    registerAdapter('instagram', () => adapter('instagram'));
  });
  afterAll(async () => {
    clearAdapters();
    resetConnectionConsumers();
    await database.close();
  });
  afterEach(() => {
    pages = [];
    revokeResult = 'done';
    revokeCalls = 0;
    events = [];
    cancelledByConsumers = 0;
    igSource = 'src-page';
    resetConnectionConsumers();
  });

  const service = () =>
    new ConnectionsService(new PgConnectionStore(), new FakeCredentialVault(), () => new Date(), {
      settings: {
        get: () => Promise.resolve({ maxPerPlatform: 5, expiryWarnDays: 7, selectionTtlSec: 900 }),
      } as never,
      notifications: {
        emit: (_tx: unknown, ev: NotificationEvent) => {
          events.push(ev);
          return Promise.resolve({ status: 'queued' as const });
        },
      },
    });

  const as = <T>(accountId: string, userId: string, fn: () => Promise<T>): Promise<T> =>
    withAccount(accountId, () => {
      const ctx = executionStorage.getStore();
      if (ctx === undefined) throw new Error('thiếu ngữ cảnh');
      ctx.actor = {
        kind: 'user',
        userId,
        accountId,
        role: 'owner',
        emailVerified: true,
        sessionId: uuidV7(),
        detached: false,
      };
      return fn();
    });

  /** Kết nối mới một kênh (loại + mã nền tảng) và trả `connectionId`. */
  async function connect(
    acc: string,
    user: string,
    type: 'facebook_page' | 'instagram',
    externalId: string,
  ): Promise<string> {
    pages = [externalId];
    return as(acc, user, async () => {
      const svc = service();
      const { authorizeUrl } = await svc.startConnect(type, REDIRECT);
      const state = new URL(authorizeUrl).searchParams.get('state') ?? '';
      const out = await svc.handleCallback(type, { state, code: 'c' }, REDIRECT);
      if (out.kind !== 'selection') throw new Error(`kỳ vọng selection, nhận ${out.kind}`);
      const res = await svc.confirm(out.selectionId, [externalId]);
      const id = res.results[0]?.connection?.connectionId;
      if (id === undefined) throw new Error('không tạo được kết nối');
      return id;
    });
  }

  const rowOf = (id: string) =>
    asOwner(async (c) => {
      const r = await c.query<{
        status: string;
        disconnected_at: Date | null;
        token_ciphertext: Buffer | null;
        refresh_ciphertext: Buffer | null;
        token_issued_at: Date;
        source_connection_id: string | null;
      }>(
        `SELECT status, disconnected_at, token_ciphertext, refresh_ciphertext, token_issued_at, source_connection_id
           FROM platform_gateway.channel_connections WHERE id = $1`,
        [id],
      );
      return r.rows[0];
    });

  it('kết nối lại cùng Page ⇒ GIỮ connectionId, hạn/quyền mới (token_issued_at mới hơn), hết cảnh báo', async () => {
    const acc = await createAccount();
    const user = uuidV7();
    const id = await connect(acc, user, 'facebook_page', 'pg-same');
    await asOwner((c) =>
      c.query(
        `UPDATE platform_gateway.channel_connections SET status = 'needs_reconnect', reason_code = 'TOKEN_EXPIRED' WHERE id = $1`,
        [id],
      ),
    );
    const before = await rowOf(id);
    pages = ['pg-same'];
    const out = await as(acc, user, async () => {
      const svc = service();
      const { authorizeUrl } = await svc.startConnect('facebook_page', REDIRECT, {
        reconnectConnectionId: id,
      });
      const state = new URL(authorizeUrl).searchParams.get('state') ?? '';
      return svc.handleCallback('facebook_page', { state, code: 'c' }, REDIRECT);
    });
    expect(out).toEqual({ kind: 'reconnected', connectionId: id });
    const after = await rowOf(id);
    expect(after?.status).toBe('active');
    expect(after?.token_issued_at.getTime()).toBeGreaterThan(
      before?.token_issued_at.getTime() ?? 0,
    );
    expect(after?.token_ciphertext?.equals(before?.token_ciphertext ?? Buffer.alloc(0))).toBe(
      false,
    );
  });

  it('Page khác ⇒ WRONG_CHANNEL và kênh cũ KHÔNG đổi', async () => {
    const acc = await createAccount();
    const user = uuidV7();
    const id = await connect(acc, user, 'facebook_page', 'pg-orig');
    const before = await rowOf(id);
    pages = ['pg-other'];
    const out = await as(acc, user, async () => {
      const svc = service();
      const { authorizeUrl } = await svc.startConnect('facebook_page', REDIRECT, {
        reconnectConnectionId: id,
      });
      const state = new URL(authorizeUrl).searchParams.get('state') ?? '';
      return svc.handleCallback('facebook_page', { state, code: 'c' }, REDIRECT);
    });
    expect(out).toEqual({ kind: 'error', code: 'WRONG_CHANNEL' });
    const after = await rowOf(id);
    expect(after?.token_ciphertext?.equals(before?.token_ciphertext ?? Buffer.alloc(0))).toBe(true);
    expect(after?.token_issued_at.getTime()).toBe(before?.token_issued_at.getTime());
  });

  it('ngắt ⇒ disconnected + hai bản mã NULL, onDisconnect chạy TRONG giao dịch, thu hồi done; ngắt lại 200 idempotent', async () => {
    const acc = await createAccount();
    const user = uuidV7();
    const id = await connect(acc, user, 'facebook_page', 'pg-disc');
    let sawTx = false;
    registerConnectionConsumers({
      scheduledImpact: (ids) =>
        Promise.resolve(new Map(ids.map((i) => [i, { count: 2, nextAt: null }]))),
      onDisconnect: (tx) => {
        sawTx = typeof (tx as { execute?: unknown }).execute === 'function';
        cancelledByConsumers = 2;
        return Promise.resolve({ cancelled: 2 });
      },
      errorMappings: () => Promise.resolve([]),
    });

    const preview = await as(acc, user, () => service().disconnectPreview(id));
    expect(preview.scheduledImpact.count).toBe(2);
    expect(preview.dependents).toEqual([]);

    const res = await as(acc, user, () => service().disconnect(id));
    expect(res).toMatchObject({ disconnected: true, revoked: 'done', cancelledAttempts: 2 });
    expect(sawTx).toBe(true);
    expect(cancelledByConsumers).toBe(2);
    const row = await rowOf(id);
    expect(row?.status).toBe('disconnected');
    expect(row?.disconnected_at).not.toBeNull();
    expect(row?.token_ciphertext).toBeNull();
    expect(row?.refresh_ciphertext).toBeNull();

    const again = await as(acc, user, () => service().disconnect(id));
    expect(again).toMatchObject({ disconnected: true, cancelledAttempts: 0 });
    expect(revokeCalls).toBe(1); // lần hai không thu hồi lại

    // ngắt rồi kết nối lại ⇒ HÀNG MỚI (không phục hồi hàng cũ)
    const again2 = await connect(acc, user, 'facebook_page', 'pg-disc');
    expect(again2).not.toBe(id);
  });

  it('thu hồi thất bại ⇒ revoked:failed + hintVi nhưng VẪN xóa mã phía mình (FR-017)', async () => {
    const acc = await createAccount();
    const user = uuidV7();
    const id = await connect(acc, user, 'facebook_page', 'pg-revoke-fail');
    revokeResult = 'failed';
    const res = await as(acc, user, () => service().disconnect(id));
    expect(res.revoked).toBe('failed');
    expect(res.hintVi).toBeDefined();
    const row = await rowOf(id);
    expect(row?.token_ciphertext).toBeNull();
    expect(row?.refresh_ciphertext).toBeNull();
  });

  it('còn kênh Meta khác ⇒ KHÔNG thu hồi (quyền gắn với người dùng + ứng dụng) và nêu hướng dẫn', async () => {
    const acc = await createAccount();
    const user = uuidV7();
    const a = await connect(acc, user, 'facebook_page', 'pg-a');
    await connect(acc, user, 'facebook_page', 'pg-b');
    const res = await as(acc, user, () => service().disconnect(a));
    expect(res.revoked).toBe('skipped');
    expect(res.hintVi).toBeDefined();
    expect(revokeCalls).toBe(0);
  });

  it('ngắt Page ⇒ preview liệt kê Instagram phụ thuộc; sau ngắt có MỘT thông báo gộp cho Instagram', async () => {
    const acc = await createAccount();
    const user = uuidV7();
    const page = await connect(acc, user, 'facebook_page', 'src-page');
    const ig = await connect(acc, user, 'instagram', 'ig-1');
    expect((await rowOf(ig))?.source_connection_id).toBe(page);

    const preview = await as(acc, user, () => service().disconnectPreview(page));
    expect(preview.dependents.map((d) => d.connectionId)).toEqual([ig]);

    await as(acc, user, () => service().disconnect(page));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('channel_needs_reconnect');
    expect((events[0] as { refs: { connectionId: string; reason: string } }).refs).toMatchObject({
      connectionId: ig,
      reason: 'source_page_lost',
    });
    // Instagram KHÔNG bị xóa mã quyền: vẫn còn bản mã, chỉ cần kết nối lại khi Page phục hồi.
    expect((await rowOf(ig))?.token_ciphertext).not.toBeNull();
  });

  it('T067: Page nguồn hỏng ⇒ Instagram dẫn xuất needs_reconnect (SOURCE_PAGE_LOST) KHÔNG đổi dòng/mã; Page phục hồi ⇒ Instagram tự active', async () => {
    const acc = await createAccount();
    const user = uuidV7();
    igSource = 'dep-page';
    const page = await connect(acc, user, 'facebook_page', 'dep-page');
    const ig = await connect(acc, user, 'instagram', 'dep-ig');
    const igBefore = await rowOf(ig);
    const stateOfIg = async () =>
      (await as(acc, user, () => service().overview())).connections.find(
        (c) => c.connectionId === ig,
      );

    await asOwner((c) =>
      c.query(
        `UPDATE platform_gateway.channel_connections SET status = 'needs_reconnect', reason_code = 'TOKEN_EXPIRED' WHERE id = $1`,
        [page],
      ),
    );
    const lost = await stateOfIg();
    expect(lost?.state).toBe('needs_reconnect');
    expect(lost?.reasonCode).toBe('SOURCE_PAGE_LOST');
    const igDuring = await rowOf(ig);
    expect(igDuring?.status).toBe('active'); // trạng thái LƯU của Instagram không đổi (dẫn xuất)
    expect(igDuring?.token_ciphertext?.equals(igBefore?.token_ciphertext ?? Buffer.alloc(0))).toBe(
      true,
    ); // không bị xóa mã quyền

    await asOwner((c) =>
      c.query(
        `UPDATE platform_gateway.channel_connections SET status = 'active', reason_code = NULL WHERE id = $1`,
        [page],
      ),
    );
    expect((await stateOfIg())?.state).toBe('active'); // không cần cấp quyền lại Instagram
  });

  it('disconnectAll: ngắt mọi kết nối, chạy lại hai lần cho cùng kết quả', async () => {
    const acc = await createAccount();
    const user = uuidV7();
    await connect(acc, user, 'facebook_page', 'all-1');
    await connect(acc, user, 'facebook_page', 'all-2');
    const first = await as(acc, user, () => service().disconnectAll());
    expect(first.disconnected).toBe(2);
    const second = await as(acc, user, () => service().disconnectAll());
    expect(second.disconnected).toBe(0);
    const live = await as(acc, user, () => service().listConnections());
    expect(live.filter((c) => c.status !== 'disconnected')).toHaveLength(0);
    expect(revokeCalls).toBe(1); // một mã người dùng chỉ thu hồi MỘT lần
  });
});
