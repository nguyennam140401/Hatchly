// 010 T018 (FR-023, FR-042, FR-036): thao tác công khai mới của cổng trên Postgres thật – `reportAuthFailure` chỉ
// `active → needs_reconnect`, idempotent, nguyên tử với thông báo; gom Instagram phụ thuộc; `disconnectAllForAccount`;
// `listConnections` lọc theo trạng thái dẫn xuất; `isFeatureEnabled` = ghi đè ?? mặc định.
import { randomBytes } from 'node:crypto';
import type { NotificationEvent } from '@app/shared/notifications';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { tenantTx } from '../../../src/core/db';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { PgConnectionStore } from '../../../src/modules/platform_gateway/internal/connections/pg-connection-store';
import {
  registerConnectionConsumers,
  resetConnectionConsumers,
} from '../../../src/modules/platform_gateway/internal/connections/consumers';
import { FeatureGate } from '../../../src/modules/platform_gateway/internal/features/feature-gate';
import { PgFeatureReader } from '../../../src/modules/platform_gateway/internal/features/pg-feature-reader';
import { PlatformGatewayService } from '../../../src/modules/platform_gateway/internal/gateway.service';
import { GatewaySettings } from '../../../src/modules/platform_gateway/internal/settings/gateway-settings';
import { PgGatewaySettingsReader } from '../../../src/modules/platform_gateway/internal/settings/pg-gateway-settings-reader';
import { FakeCredentialVault } from '../../../src/modules/platform_gateway/internal/vault/credential-vault';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from '../helpers/db';

const DAY = 86_400_000;

describeDb('Thao tác công khai mới của cổng nền tảng (010)', () => {
  let database: TestDatabase;
  let events: NotificationEvent[];
  let failEmit = false;
  const store = new PgConnectionStore();

  const makeService = () =>
    new PlatformGatewayService({
      store,
      vault: new FakeCredentialVault(),
      submitTimeoutMs: 1000,
      features: new FeatureGate(new PgFeatureReader(), { ttlMs: 0 }),
      settings: new GatewaySettings(new PgGatewaySettingsReader(), { ttlMs: 0 }),
      notifications: {
        emit: (_tx, event) => {
          if (failEmit) return Promise.reject(new Error('gửi thông báo lỗi'));
          events.push(event);
          return Promise.resolve({ status: 'queued' as const });
        },
      },
    });

  beforeAll(() => {
    database = makeDatabase();
  });
  afterAll(async () => {
    await database.close();
  });
  beforeEach(() => {
    events = [];
    failEmit = false;
    resetConnectionConsumers();
  });

  /** Mồi kết nối bằng owner (bản mã giả). */
  async function seed(
    accountId: string,
    over: {
      type?: string;
      name?: string;
      source?: string | null;
      expires?: Date | null;
      status?: string;
    } = {},
  ): Promise<string> {
    const id = uuidV7();
    const status = over.status ?? 'active';
    await asOwner((c) =>
      c.query(
        `INSERT INTO platform_gateway.channel_connections
           (id, account_id, channel_type, external_id, display_name, source_connection_id, token_ciphertext,
            token_issued_at, expiry_kind, token_expires_at, status, disconnected_at, connected_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9, $10, $11, now())`,
        [
          id,
          accountId,
          over.type ?? 'facebook_page',
          `ext-${randomBytes(6).toString('hex')}`,
          over.name ?? 'Page thử',
          over.source ?? null,
          status === 'disconnected' ? null : randomBytes(40),
          over.expires === null ? 'none' : 'token',
          over.expires === null ? null : (over.expires ?? new Date(Date.now() + 30 * DAY)),
          status,
          status === 'disconnected' ? new Date() : null,
        ],
      ),
    );
    return id;
  }

  const rowOf = (id: string) =>
    asOwner(
      async (c) =>
        (
          await c.query<{
            status: string;
            reason_code: string | null;
            last_error_code: string | null;
            version: number;
            token_ciphertext: Buffer | null;
          }>(
            'SELECT status, reason_code, last_error_code, version, token_ciphertext FROM platform_gateway.channel_connections WHERE id = $1',
            [id],
          )
        ).rows[0],
    );

  it('reportAuthFailure: active → needs_reconnect, lọc mã gốc, đúng MỘT thông báo; gọi lại không làm gì', async () => {
    const acc = await createAccount();
    const id = await seed(acc, { name: 'Page Cà phê' });
    const svc = makeService();
    registerConnectionConsumers({
      scheduledImpact: (ids) =>
        Promise.resolve(new Map(ids.map((i) => [i, { count: 3, nextAt: null }]))),
      onDisconnect: () => Promise.resolve({ cancelled: 0 }),
      errorMappings: () => Promise.resolve([]),
    });

    await withAccount(acc, () =>
      svc.reportAuthFailure(id, { kind: 'token_revoked', rawCode: 'OAuth <script> 190!' }),
    );
    const row = await rowOf(id);
    expect(row?.status).toBe('needs_reconnect');
    expect(row?.reason_code).toBe('TOKEN_REVOKED');
    expect(row?.last_error_code).toBe('OAuth__script__190_');
    expect(row?.version).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'channel_needs_reconnect',
      refs: { connectionId: id, reason: 'token_revoked' },
      params: { channelDisplayName: 'Page Cà phê', affectedPosts: 3 },
    });

    // Idempotent: đã needs_reconnect ⇒ không đổi version, không thông báo thêm.
    await withAccount(acc, () =>
      svc.reportAuthFailure(id, { kind: 'token_expired', rawCode: 'X' }),
    );
    expect((await rowOf(id))?.version).toBe(2);
    expect(events).toHaveLength(1);

    // Trạng thái công khai: 4 giá trị cũ (expired) + trạng thái hiển thị mới.
    const view = await withAccount(acc, () => svc.getConnection(id));
    expect(view).toMatchObject({
      status: 'expired',
      state: 'needs_reconnect',
      reasonCode: 'TOKEN_REVOKED',
    });
  });

  it('nguyên tử: gửi thông báo lỗi ⇒ trạng thái KHÔNG đổi (cùng giao dịch)', async () => {
    const acc = await createAccount();
    const id = await seed(acc);
    failEmit = true;
    await expect(
      withAccount(acc, () =>
        makeService().reportAuthFailure(id, { kind: 'token_expired', rawCode: 'X' }),
      ),
    ).rejects.toThrow();
    expect((await rowOf(id))?.status).toBe('active');
  });

  it('gom: Page hỏng kéo theo Instagram phụ thuộc trong MỘT thông báo; Instagram tự "cần kết nối lại"', async () => {
    const acc = await createAccount();
    const page = await seed(acc, { name: 'Page Gió' });
    const ig = await seed(acc, { type: 'instagram', name: '@gio', source: page });
    const svc = makeService();
    expect((await withAccount(acc, () => svc.getConnection(ig)))?.state).toBe('active');

    await withAccount(acc, () =>
      svc.reportAuthFailure(page, { kind: 'token_expired', rawCode: 'E190' }),
    );
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev?.type === 'channel_needs_reconnect' && ev.refs.connectionIds?.sort()).toEqual(
      [page, ig].sort(),
    );
    expect(ev?.params?.channelDisplayName).toBe('Page Gió và 1 kênh khác');
    // Instagram không bị ghi trạng thái "phụ" – dẫn xuất từ Page nguồn.
    expect((await rowOf(ig))?.status).toBe('active');
    expect(await withAccount(acc, () => svc.getConnection(ig))).toMatchObject({
      state: 'needs_reconnect',
      reasonCode: 'SOURCE_PAGE_LOST',
      status: 'expired',
    });
  });

  it('listConnections: usableOnly chỉ active|expiring; lọc theo loại; hạn gần ⇒ expiring', async () => {
    const acc = await createAccount();
    const ok = await seed(acc, { name: 'OK' });
    const soon = await seed(acc, { name: 'Sắp hết', expires: new Date(Date.now() + 3 * DAY) });
    const noExpiry = await seed(acc, { name: 'Không hạn', expires: null });
    const broken = await seed(acc, { name: 'Hỏng', status: 'needs_reconnect' });
    const gone = await seed(acc, { name: 'Đã ngắt', status: 'disconnected' });
    const ig = await seed(acc, { type: 'instagram', name: 'IG', source: ok });
    const svc = makeService();

    const all = await withAccount(acc, () => svc.listConnections());
    expect(all).toHaveLength(6);
    const byId = new Map(all.map((c) => [c.connectionId, c]));
    expect(byId.get(soon)).toMatchObject({ state: 'expiring', status: 'expiring' });
    expect(byId.get(noExpiry)).toMatchObject({
      state: 'active',
      tokenExpiresAt: null,
      expiry: { kind: 'none' },
    });
    expect(byId.get(broken)).toMatchObject({ state: 'needs_reconnect', status: 'expired' });
    expect(byId.get(gone)).toMatchObject({ state: 'disconnected', status: 'disconnected' });

    const usable = await withAccount(acc, () => svc.listConnections({ usableOnly: true }));
    expect(usable.map((c) => c.connectionId).sort()).toEqual([ok, soon, noExpiry, ig].sort());
    const igOnly = await withAccount(acc, () =>
      svc.listConnections({ channelTypes: ['instagram'] }),
    );
    expect(igOnly.map((c) => c.connectionId)).toEqual([ig]);
  });

  it('disconnectAllForAccount: ngắt mọi kết nối chưa ngắt, xóa bản mã, gọi onDisconnect từng kênh; lặp lại = 0', async () => {
    const acc = await createAccount();
    const other = await createAccount();
    const a1 = await seed(acc);
    const a2 = await seed(acc, { status: 'needs_reconnect' });
    await seed(acc, { status: 'disconnected' });
    const b1 = await seed(other);
    const hooked: string[] = [];
    registerConnectionConsumers({
      scheduledImpact: () => Promise.resolve(new Map()),
      onDisconnect: (_tx, id) => {
        hooked.push(id);
        return Promise.resolve({ cancelled: 1 });
      },
      errorMappings: () => Promise.resolve([]),
    });
    const svc = makeService();

    expect(await withAccount(acc, () => svc.disconnectAllForAccount())).toEqual({
      disconnected: 2,
    });
    expect(hooked.sort()).toEqual([a1, a2].sort());
    for (const id of [a1, a2]) {
      const r = await rowOf(id);
      expect(r?.status).toBe('disconnected');
      expect(r?.token_ciphertext).toBeNull();
    }
    expect((await rowOf(b1))?.status).toBe('active'); // tài khoản khác không bị ảnh hưởng
    expect(await withAccount(acc, () => svc.disconnectAllForAccount())).toEqual({
      disconnected: 0,
    });
  });

  it('isFeatureEnabled: mặc định tắt; ghi đè bật chỉ cho đúng tài khoản; đổi mặc định ảnh hưởng tài khoản không ghi đè', async () => {
    const a = await createAccount();
    const b = await createAccount();
    const svc = makeService();
    expect(await withAccount(a, () => svc.isFeatureEnabled('channel.tiktok'))).toBe(false);

    await asOwner((c) =>
      c.query(
        `INSERT INTO platform_gateway.feature_overrides (id, account_id, flag_key, value, reason, changed_by_staff_id)
         VALUES ($1, $2, 'channel.tiktok', true, 'Khách thử nghiệm', $3)`,
        [uuidV7(), a, uuidV7()],
      ),
    );
    expect(await withAccount(a, () => svc.isFeatureEnabled('channel.tiktok'))).toBe(true);
    expect(await withAccount(b, () => svc.isFeatureEnabled('channel.tiktok'))).toBe(false);

    try {
      await asOwner((c) =>
        c.query(
          `UPDATE platform_gateway.gateway_settings SET value = 'true'::jsonb, updated_at = now() WHERE key = 'channel.tiktok.enabled_default'`,
        ),
      );
      expect(await withAccount(b, () => svc.isFeatureEnabled('channel.tiktok'))).toBe(true);
    } finally {
      await asOwner((c) =>
        c.query(
          `UPDATE platform_gateway.gateway_settings SET value = 'false'::jsonb WHERE key = 'channel.tiktok.enabled_default'`,
        ),
      );
    }
  });

  it('không có ngữ cảnh tài khoản ⇒ isFeatureEnabled ném (không đoán tài khoản)', async () => {
    await expect(makeService().isFeatureEnabled('channel.tiktok')).rejects.toThrow();
    expect(typeof tenantTx).toBe('function');
  });
});
