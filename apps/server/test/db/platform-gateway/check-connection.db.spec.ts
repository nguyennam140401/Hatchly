// 010 T055/T056/T057 (US5, FR-012, FR-020, FR-033, R5): việc `check_connection` trên Postgres thật với đồng hồ giả –
// chuỗi nhắc d7 → d1 → expired chỉ phát khi mốc tăng, gom kênh cùng hạn, lỗi tạm thời không đổi trạng thái, làm mới thành công,
// đua với người dùng kết nối lại, chạy lại hai lần cho cùng kết quả, gói hết hạn ⇒ 0 lời gọi nền tảng.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { NotificationEvent } from '@app/shared/notifications';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import {
  clearAdapters,
  registerAdapter,
} from '../../../src/modules/platform_gateway/internal/adapters/registry';
import type { PlatformAdapter } from '../../../src/modules/platform_gateway/internal/adapters/adapter';
import {
  registerConnectionConsumers,
  resetConnectionConsumers,
} from '../../../src/modules/platform_gateway/internal/connections/consumers';
import { PgConnectionStore } from '../../../src/modules/platform_gateway/internal/connections/pg-connection-store';
import { createCheckConnectionHandler } from '../../../src/modules/platform_gateway/internal/maintenance/check-connection.handler';
import {
  credentialAad,
  FakeCredentialVault,
} from '../../../src/modules/platform_gateway/internal/vault/credential-vault';
import type { AccountCheckResult, ExpiryInfo } from '../../../src/modules/platform_gateway/public-api';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from '../helpers/db';

const NOW = new Date('2026-11-20T03:00:00.000Z'); // 10:00 UTC+7
const DAY = 86_400_000;
const HOUR = 3_600_000;

const eligible = (expiresAt: Date | null): AccountCheckResult => ({
  kind: 'eligible',
  quotaRemaining: null,
  grantedScopes: ['pages_manage_posts'],
  accountType: 'page',
  tokenExpiresAt: expiresAt ?? new Date(NOW.getTime() + 365 * DAY),
  ...(expiresAt === null
    ? { expiry: { kind: 'none' } as ExpiryInfo }
    : { expiry: { kind: 'token', expiresAt } as ExpiryInfo }),
});

describeDb('check_connection (nhắc hạn, làm mới, đua, chạy lại)', () => {
  let database: TestDatabase;
  let clock = NOW;
  let events: NotificationEvent[] = [];
  let planActive = true;
  let platformCalls = 0;
  let checkResult: (expiresAt: Date | null) => AccountCheckResult | Promise<AccountCheckResult>;
  let renew:
    | undefined
    | (() => Promise<
        | { kind: 'renewed'; accessToken: string; refreshToken: string; expiry: ExpiryInfo }
        | { kind: 'failed'; error: never }
      >);
  let tokenRefresh = false;
  const vault = new FakeCredentialVault();
  const store = new PgConnectionStore();

  const adapter = (): PlatformAdapter =>
    ({
      channelType: 'facebook_page',
      get capabilities() {
        return { tokenRefresh };
      },
      checkAccount: async () => {
        platformCalls++;
        return checkResult(currentExpiry);
      },
      expiryOf: async () => ({ kind: 'none' }),
      renewToken: () => (renew === undefined ? Promise.reject(new Error('no renew')) : renew()),
    }) as unknown as PlatformAdapter;
  let currentExpiry: Date | null = null;

  beforeAll(() => {
    database = makeDatabase();
    registerAdapter('facebook_page', adapter);
  });
  afterAll(async () => {
    clearAdapters();
    await database.close();
  });
  beforeEach(() => {
    clock = NOW;
    events = [];
    planActive = true;
    platformCalls = 0;
    renew = undefined;
    tokenRefresh = false;
    currentExpiry = null;
    checkResult = (exp) => eligible(exp);
  });

  const handler = () =>
    createCheckConnectionHandler({
      store,
      vault,
      settings: {
        get: () => Promise.resolve({ expiryWarnDays: 7, checkBatchLimit: 500 }),
      } as never,
      features: { isEnabled: () => Promise.resolve(true) } as never,
      notifications: {
        emit: (_tx: unknown, ev: NotificationEvent) => {
          events.push(ev);
          return Promise.resolve({ status: 'queued' as const });
        },
      },
      eligibility: () => Promise.resolve({ planActive, deletionRequested: false }),
      now: () => clock,
    });

  /** Mồi một Page với hạn `expiresAt` (null ⇒ không có hạn cố định). */
  async function seed(acc: string, externalId: string, expiresAt: Date | null, name = 'Tiệm Hoa') {
    return withAccount(acc, async () => {
      const token = await vault.encrypt(
        `tok-${externalId}`,
        credentialAad(acc, 'token', 'facebook_page', externalId),
      );
      const refresh = await vault.encrypt(
        `usr-${externalId}`,
        credentialAad(acc, 'refresh', 'facebook_page', externalId),
      );
      const { connection } = await store.insertConnection({
        channelType: 'facebook_page',
        externalId,
        displayName: name,
        tokenCiphertext: token,
        refreshCiphertext: refresh,
        tokenExpiresAt: expiresAt,
        expiryKind: expiresAt === null ? 'none' : 'token',
        maxPerPlatform: 10,
      });
      return connection;
    });
  }

  const check = (acc: string, id: string) => withAccount(acc, () => handler()(id));
  const rowOf = (id: string) =>
    asOwner(async (c) => {
      const r = await c.query<{
        status: string;
        reason_code: string | null;
        last_checked_at: Date | null;
        last_notified_stage: string | null;
        token_issued_at: Date;
        version: number;
      }>(
        `SELECT status, reason_code, last_checked_at, last_notified_stage, token_issued_at, version
           FROM platform_gateway.channel_connections WHERE id = $1`,
        [id],
      );
      return r.rows[0];
    });
  const uniq = (p: string) => `${p}-${uuidV7().slice(-8)}`;

  it('chuỗi d7 → d1 → expired: mỗi mốc đúng một thông báo, chạy lại cùng mốc không phát lại', async () => {
    const acc = await createAccount();
    const c = await seed(acc, uniq('p'), new Date(NOW.getTime() + 6 * DAY));
    currentExpiry = new Date(NOW.getTime() + 6 * DAY);

    expect(await check(acc, c.id)).toBe('ok');
    expect(events.map((e) => (e as { refs: { stage?: string } }).refs.stage)).toEqual(['d7']);
    await check(acc, c.id); // cùng mốc ⇒ không phát lại
    expect(events).toHaveLength(1);

    // còn dưới 1 ngày
    clock = new Date(NOW.getTime() + 5 * DAY + 20 * HOUR);
    await check(acc, c.id);
    expect(events.map((e) => (e as { refs: { stage?: string } }).refs.stage)).toEqual(['d7', 'd1']);

    // đã quá hạn: needs_reconnect + mốc expired
    clock = new Date(NOW.getTime() + 6 * DAY + HOUR);
    expect(await check(acc, c.id)).toBe('changed');
    expect(events.map((e) => (e as { refs: { stage?: string } }).refs.stage)).toEqual([
      'd7',
      'd1',
      'expired',
    ]);
    const row = await rowOf(c.id);
    expect(row?.status).toBe('needs_reconnect');
    expect(row?.reason_code).toBe('TOKEN_EXPIRED');
    expect(row?.last_notified_stage).toBe('expired');
  });

  it('nhiều kênh cùng hết hạn một ngày ⇒ MỘT thông báo liệt kê connectionIds; kênh kia không báo lại', async () => {
    const acc = await createAccount();
    const exp = new Date(NOW.getTime() + 5 * DAY);
    const [a, b, d] = [
      await seed(acc, uniq('a'), exp, 'Kênh A'),
      await seed(acc, uniq('b'), exp, 'Kênh B'),
      await seed(acc, uniq('c'), exp, 'Kênh C'),
    ];
    currentExpiry = exp;
    await check(acc, a.id);
    expect(events).toHaveLength(1);
    const ev = events[0] as { refs: { connectionIds?: string[] }; params: { channelDisplayName: string } };
    expect(new Set(ev.refs.connectionIds)).toEqual(new Set([a.id, b.id, d.id]));
    expect(ev.params.channelDisplayName).toContain('và 2 kênh khác');
    await check(acc, b.id);
    await check(acc, d.id);
    expect(events).toHaveLength(1);
  });

  it('lỗi tạm thời/mã lạ ⇒ trạng thái không đổi, KHÔNG cập nhật last_checked_at, không nhắc', async () => {
    const acc = await createAccount();
    const c = await seed(acc, uniq('p'), null);
    const before = await rowOf(c.id);
    checkResult = () => ({
      kind: 'ineligible',
      error: {
        category: 'transient',
        rawCode: 'FB:5XX',
        channelType: 'facebook_page',
        messageVi: 'Nền tảng đang bận.',
        remedies: [{ action: 'retry_later', labelVi: 'Thử lại sau' }],
      },
    });
    expect(await check(acc, c.id)).toBe('deferred');
    const after = await rowOf(c.id);
    expect(after?.status).toBe(before?.status);
    expect(after?.last_checked_at?.getTime()).toBe(before?.last_checked_at?.getTime());
    expect(events).toHaveLength(0);
  });

  it('Meta không có hạn (expiry none) ⇒ không nhắc hạn; kiểm tra hằng ngày vẫn ghi last_checked_at', async () => {
    const acc = await createAccount();
    const c = await seed(acc, uniq('p'), null);
    expect(await check(acc, c.id)).toBe('ok');
    expect(events).toHaveLength(0);
    expect((await rowOf(c.id))?.last_checked_at).not.toBeNull();
  });

  it('khẳng định bị thu hồi (user_action + reconnect) ⇒ needs_reconnect + đúng MỘT thông báo (cả khi chạy lại)', async () => {
    const acc = await createAccount();
    const c = await seed(acc, uniq('p'), null);
    checkResult = () => ({
      kind: 'ineligible',
      error: {
        category: 'user_action',
        rawCode: 'FB:TOKEN_REVOKED',
        channelType: 'facebook_page',
        messageVi: 'Quyền đã bị thu hồi.',
        remedies: [{ action: 'reconnect', labelVi: 'Kết nối lại' }],
      },
    });
    // Số bài đã lên lịch bị ảnh hưởng đi vào thông báo dạng SỐ NGUYÊN (không nội dung bài, không số tiền) – T057.
    registerConnectionConsumers({
      scheduledImpact: (ids) =>
        Promise.resolve(new Map(ids.map((id) => [id, { count: 3, nextAt: null }]))),
      onDisconnect: () => Promise.resolve({ cancelled: 0 }),
      errorMappings: () => Promise.resolve([]),
    });
    try {
      expect(await check(acc, c.id)).toBe('changed');
    } finally {
      resetConnectionConsumers();
    }
    expect((await rowOf(c.id))?.status).toBe('needs_reconnect');
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('channel_needs_reconnect');
    expect((events[0] as { params: { affectedPosts?: number } }).params.affectedPosts).toBe(3);
    await check(acc, c.id); // lần hai: đã needs_reconnect ⇒ không báo lại
    expect(events).toHaveLength(1);
  });

  it('gói hết hạn ⇒ 0 lời gọi nền tảng, 0 thông báo, chỉ đặt recheck_required', async () => {
    const acc = await createAccount();
    const c = await seed(acc, uniq('p'), new Date(NOW.getTime() + 2 * DAY));
    planActive = false;
    expect(await check(acc, c.id)).toBe('skipped');
    expect(platformCalls).toBe(0);
    expect(events).toHaveLength(0);
    const flag = await asOwner(async (cl) =>
      (
        await cl.query<{ recheck_required: boolean }>(
          'SELECT recheck_required FROM platform_gateway.channel_connections WHERE id = $1',
          [c.id],
        )
      ).rows[0]?.recheck_required,
    );
    expect(flag).toBe(true);
  });

  it('làm mới thành công ⇒ quyền mới, token_issued_at mới, không thông báo, mốc nhắc xóa', async () => {
    const acc = await createAccount();
    const c = await seed(acc, uniq('p'), new Date(NOW.getTime() + 3 * DAY));
    tokenRefresh = true;
    const newExp = new Date(NOW.getTime() + 60 * DAY);
    renew = () =>
      Promise.resolve({
        kind: 'renewed' as const,
        accessToken: 'tok-new',
        refreshToken: 'usr-new',
        expiry: { kind: 'token', expiresAt: newExp },
      });
    currentExpiry = newExp;
    expect(await check(acc, c.id)).toBe('ok');
    expect(events).toHaveLength(0);
    const row = await rowOf(c.id);
    expect(row?.token_issued_at.getTime()).toBe(NOW.getTime());
    expect(row?.last_notified_stage).toBeNull();
  });

  it('đua: người dùng kết nối lại (token_issued_at mới hơn) trong lúc kiểm tra ⇒ kết quả cũ bị bỏ, quyền mới giữ nguyên', async () => {
    const acc = await createAccount();
    const c = await seed(acc, uniq('p'), null);
    // Giữa lúc gọi nền tảng, "người dùng" kết nối lại: version tăng + token_issued_at mới.
    checkResult = async () => {
      await asOwner((cl) =>
        cl.query(
          `UPDATE platform_gateway.channel_connections
              SET token_issued_at = now() + interval '1 minute', version = version + 1 WHERE id = $1`,
          [c.id],
        ),
      );
      return eligible(null);
    };
    const before = await rowOf(c.id);
    expect(await check(acc, c.id)).toBe('lost_race');
    const after = await rowOf(c.id);
    expect(after?.token_issued_at.getTime()).toBeGreaterThan(before?.token_issued_at.getTime() ?? 0);
    expect(after?.last_checked_at?.getTime()).toBe(before?.last_checked_at?.getTime());
  });

  it('hai Worker chạy ĐỒNG THỜI cùng một kết nối ⇒ đúng MỘT thông báo (cập nhật có điều kiện theo version)', async () => {
    const acc = await createAccount();
    const exp = new Date(NOW.getTime() + 6 * DAY);
    const c = await seed(acc, uniq('p'), exp);
    currentExpiry = exp;
    await Promise.all([check(acc, c.id), check(acc, c.id)]);
    expect(events).toHaveLength(1);
    expect((await rowOf(c.id))?.last_notified_stage).toBe('d7');
  });

  it('chạy lại hai lần cho cùng kết quả (trạng thái + số thông báo)', async () => {
    const acc = await createAccount();
    const exp = new Date(NOW.getTime() + 6 * DAY);
    const c = await seed(acc, uniq('p'), exp);
    currentExpiry = exp;
    await check(acc, c.id);
    const first = { row: await rowOf(c.id), n: events.length };
    await check(acc, c.id);
    const second = { row: await rowOf(c.id), n: events.length };
    expect(second.n).toBe(first.n);
    expect(second.row?.status).toBe(first.row?.status);
    expect(second.row?.last_notified_stage).toBe(first.row?.last_notified_stage);
  });
});
