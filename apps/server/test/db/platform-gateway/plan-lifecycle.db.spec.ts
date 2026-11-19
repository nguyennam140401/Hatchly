// 010 T071 (US7, FR-033): gói hết hạn ⇒ kết nối mới VÀ kết nối lại bị 403 PLAN_EXPIRED, vẫn xem + ngắt được; gia hạn ⇒ kết nối
// đã đánh dấu `recheck_required` được kiểm tra lại ở lần quét kế tiếp (việc hằng ngày 0 lời gọi khi hết hạn: xem check-connection.db.spec).
import { afterAll, beforeAll, expect, it } from 'vitest';
import { executionStorage } from '../../../src/core/context/execution-storage';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import {
  clearAdapters,
  registerAdapter,
} from '../../../src/modules/platform_gateway/internal/adapters/registry';
import type { PlatformAdapter } from '../../../src/modules/platform_gateway/internal/adapters/adapter';
import { ConnectionsService } from '../../../src/modules/platform_gateway/internal/connections/connections.service';
import { PgConnectionStore } from '../../../src/modules/platform_gateway/internal/connections/pg-connection-store';
import { FakeCredentialVault } from '../../../src/modules/platform_gateway/internal/vault/credential-vault';
import { createAccount, describeDb, makeDatabase, withAccount, type TestDatabase } from '../helpers/db';

const REDIRECT = 'https://app.example.test/api/v1/channels/callback/facebook_page';

describeDb('Vòng đời gói và kết nối kênh (FR-033)', () => {
  let database: TestDatabase;
  let planActive = true;

  beforeAll(() => {
    database = makeDatabase();
    registerAdapter(
      'facebook_page',
      () =>
        ({
          channelType: 'facebook_page',
          authorizeUrl: (state: string) => `https://www.facebook.test/dialog/oauth?state=${state}`,
          exchangeCallback: () =>
            Promise.resolve({
              candidates: [
                {
                  externalId: 'plan-page',
                  displayName: 'Trang',
                  accessToken: 'tok',
                  tokenExpiresAt: null,
                  expiry: { kind: 'none' },
                },
              ],
            }),
          checkAccount: () =>
            Promise.resolve({
              kind: 'eligible',
              quotaRemaining: null,
              grantedScopes: [],
              accountType: null,
              tokenExpiresAt: new Date(Date.now() + 86_400_000),
            }),
          revoke: () => Promise.resolve('done'),
        }) as unknown as PlatformAdapter,
    );
  });
  afterAll(async () => {
    clearAdapters();
    await database.close();
  });

  const service = () =>
    new ConnectionsService(new PgConnectionStore(), new FakeCredentialVault(), () => new Date(), {
      settings: {
        get: () => Promise.resolve({ maxPerPlatform: 5, expiryWarnDays: 7, selectionTtlSec: 900 }),
      } as never,
      eligibility: () => Promise.resolve({ planActive, deletionRequested: false }),
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

  it('gói hết hạn ⇒ kết nối mới và kết nối lại bị PLAN_EXPIRED; vẫn xem và ngắt được; gia hạn ⇒ kết nối lại được', async () => {
    const acc = await createAccount();
    const user = uuidV7();
    planActive = true;
    const id = await as(acc, user, async () => {
      const svc = service();
      const { authorizeUrl } = await svc.startConnect('facebook_page', REDIRECT);
      const state = new URL(authorizeUrl).searchParams.get('state') ?? '';
      const out = await svc.handleCallback('facebook_page', { state, code: 'c' }, REDIRECT);
      if (out.kind !== 'selection') throw new Error('kỳ vọng selection');
      const res = await svc.confirm(out.selectionId, ['plan-page']);
      return res.results[0]?.connection?.connectionId ?? '';
    });
    expect(id).not.toBe('');

    planActive = false;
    await expect(
      as(acc, user, () => service().startConnect('facebook_page', REDIRECT)),
    ).rejects.toMatchObject({ code: 'PLAN_EXPIRED' });
    await expect(
      as(acc, user, () =>
        service().startConnect('facebook_page', REDIRECT, { reconnectConnectionId: id }),
      ),
    ).rejects.toMatchObject({ code: 'PLAN_EXPIRED' });
    // vẫn xem được
    const overview = await as(acc, user, () => service().overview());
    expect(overview.connections.map((c) => c.connectionId)).toContain(id);
    expect(overview.platforms.every((p) => !p.canAdd)).toBe(true);

    // gia hạn ⇒ kết nối lại được; vẫn ngắt được khi hết hạn
    planActive = true;
    await expect(
      as(acc, user, () =>
        service().startConnect('facebook_page', REDIRECT, { reconnectConnectionId: id }),
      ),
    ).resolves.toBeDefined();
    planActive = false;
    const res = await as(acc, user, () => service().disconnect(id));
    expect(res.disconnected).toBe(true);
  });
});
