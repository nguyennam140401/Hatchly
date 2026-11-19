// 010 T022 (US1, FR-007, R8): đua kết nối ở mức dịch vụ trên Postgres thật –
// hai `confirm` cùng Page ⇒ đúng 1 kết nối; hai tài khoản cùng Page ⇒ OWNED_BY_ANOTHER_ACCOUNT (không lộ thêm);
// chọn quá chỗ còn lại ⇒ LIMIT_REACHED TRƯỚC khi tạo gì.
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
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
import { PgConnectionStore } from '../../../src/modules/platform_gateway/internal/connections/pg-connection-store';
import { ConnectionsService } from '../../../src/modules/platform_gateway/internal/connections/connections.service';
import { FakeCredentialVault } from '../../../src/modules/platform_gateway/internal/vault/credential-vault';
import {
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from '../helpers/db';

const REDIRECT = 'https://app.example.test/api/v1/channels/callback/facebook_page';
const MAX = 3;

/** Bộ chuyển đổi giả tối thiểu: trả đúng các Page do test cấp, mọi Page đều đủ điều kiện. */
function stubAdapter(pages: () => string[]): PlatformAdapter {
  return {
    channelType: 'facebook_page',
    authorizeUrl: (state: string) => `https://www.facebook.test/dialog/oauth?state=${state}`,
    exchangeCallback: () =>
      Promise.resolve({
        candidates: pages().map((id): ConnectionCandidate => ({
          externalId: id,
          displayName: `Page ${id}`,
          accessToken: `tok-${id}`,
          tokenExpiresAt: null,
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
  } as unknown as PlatformAdapter;
}

describeDb('Đua kết nối kênh (dịch vụ + Postgres)', () => {
  let database: TestDatabase;
  let pages: string[] = [];

  beforeAll(() => {
    database = makeDatabase();
    registerAdapter('facebook_page', () => stubAdapter(() => pages));
  });
  afterAll(async () => {
    clearAdapters();
    await database.close();
  });
  afterEach(() => {
    pages = [];
  });

  const service = () =>
    new ConnectionsService(new PgConnectionStore(), new FakeCredentialVault(), () => new Date(), {
      settings: {
        get: () =>
          Promise.resolve({ maxPerPlatform: MAX, expiryWarnDays: 7, selectionTtlSec: 900 }),
      } as never,
    });

  /** Chạy `fn` như khách hàng `userId` của tài khoản `accountId`. */
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

  /** Bắt đầu → gọi lại → trả mã phiên chọn. */
  async function openSelection(accountId: string, userId: string, ids: string[]): Promise<string> {
    pages = ids;
    return as(accountId, userId, async () => {
      const svc = service();
      const { authorizeUrl } = await svc.startConnect('facebook_page', REDIRECT);
      const state = new URL(authorizeUrl).searchParams.get('state') ?? '';
      const out = await svc.handleCallback('facebook_page', { state, code: 'c' }, REDIRECT);
      if (out.kind !== 'selection') throw new Error(`kỳ vọng selection, nhận ${out.kind}`);
      return out.selectionId;
    });
  }

  const page = () => `page-${randomBytes(6).toString('hex')}`;
  const liveOf = (accountId: string, userId: string) =>
    as(accountId, userId, () => service().listConnections());

  it('hai confirm cùng Page (hai thẻ trình duyệt) ⇒ chỉ một kết nối, không nhân đôi', async () => {
    const acc = await createAccount();
    const user = uuidV7();
    const p = page();
    const [s1, s2] = [await openSelection(acc, user, [p]), await openSelection(acc, user, [p])];
    const settled = await Promise.allSettled([
      as(acc, user, () => service().confirm(s1, [p])),
      as(acc, user, () => service().confirm(s2, [p])),
    ]);
    const outcomes = settled.flatMap((r) =>
      r.status === 'fulfilled' ? r.value.results.map((x) => x.outcome) : [],
    );
    expect(outcomes.filter((o) => o === 'created')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'already_connected')).toHaveLength(1);
    expect((await liveOf(acc, user)).filter((c) => c.externalId === p)).toHaveLength(1);
  });

  it('hai tài khoản cùng một Page ⇒ bên sau OWNED_BY_ANOTHER_ACCOUNT, không lộ tài khoản kia', async () => {
    const [a, b] = [await createAccount(), await createAccount()];
    const [ua, ub] = [uuidV7(), uuidV7()];
    const p = page();
    const [sa, sb] = [await openSelection(a, ua, [p]), await openSelection(b, ub, [p])];
    const ra = await as(a, ua, () => service().confirm(sa, [p]));
    expect(ra.results[0]?.outcome).toBe('created');
    const rb = await as(b, ub, () => service().confirm(sb, [p]));
    expect(rb.results[0]?.outcome).toBe('owned_by_another_account');
    const text = JSON.stringify(rb);
    expect(text).not.toContain(a); // không lộ mã tài khoản đang giữ
    const createdId = ra.results[0]?.connection?.connectionId;
    expect(createdId).toBeDefined();
    expect(text).not.toContain(createdId ?? '');
    expect(await liveOf(b, ub)).toHaveLength(0);
  });

  it('chọn quá chỗ còn lại ⇒ LIMIT_REACHED trước khi tạo bất cứ kết nối nào', async () => {
    const acc = await createAccount();
    const user = uuidV7();
    const ids = Array.from({ length: MAX + 1 }, page);
    const sel = await openSelection(acc, user, ids);
    await expect(as(acc, user, () => service().confirm(sel, ids))).rejects.toMatchObject({
      code: 'LIMIT_REACHED',
    });
    expect(await liveOf(acc, user)).toHaveLength(0);
  });

  it('hai thẻ cùng chọn đủ chỗ song song ⇒ tổng không bao giờ quá giới hạn', async () => {
    const acc = await createAccount();
    const user = uuidV7();
    const setA = Array.from({ length: MAX }, page);
    const setB = Array.from({ length: MAX }, page);
    const [s1, s2] = [await openSelection(acc, user, setA), await openSelection(acc, user, setB)];
    await Promise.allSettled([
      as(acc, user, () => service().confirm(s1, setA)),
      as(acc, user, () => service().confirm(s2, setB)),
    ]);
    expect((await liveOf(acc, user)).length).toBeLessThanOrEqual(MAX);
  });
});
