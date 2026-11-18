// 010 T066 (FR-007, R8): giới hạn số kết nối mỗi nền tảng – chọn quá chỗ còn lại song song chỉ vừa đủ N,
// ngắt trả chỗ ngay, "Cần kết nối lại" vẫn tính.
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { tenantTx, type Db } from '../../../src/core/db';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import {
  limitReached,
  lockAndCountUsed,
  remainingSlots,
} from '../../../src/modules/platform_gateway/internal/connections/limits';
import { channelConnections } from '../../../src/modules/platform_gateway/internal/db/schema';
import {
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from '../helpers/db';

const MAX = 5;

describeDb('Giới hạn kết nối mỗi nền tảng', () => {
  let database: TestDatabase;

  beforeAll(() => {
    database = makeDatabase();
  });
  afterAll(async () => {
    await database.close();
  });

  const row = (accountId: string, over: Partial<typeof channelConnections.$inferInsert> = {}) => ({
    account_id: accountId,
    channel_type: 'facebook_page',
    external_id: `page-${randomBytes(8).toString('hex')}`,
    display_name: 'Page',
    token_ciphertext: randomBytes(32),
    token_issued_at: new Date(),
    token_expires_at: new Date(Date.now() + 86_400_000),
    connected_at: new Date(),
    ...over,
  });

  /** Giống `confirm`: khóa → đếm → chèn `want` kết nối nếu còn đủ chỗ, không thì LIMIT_REACHED. */
  async function tryConnect(accountId: string, want: number): Promise<'ok' | 'LIMIT_REACHED'> {
    return withAccount(accountId, () =>
      tenantTx(async (db: Db) => {
        const used = await lockAndCountUsed(db, accountId, 'facebook_page');
        if (want > remainingSlots(used, MAX)) throw limitReached(used, MAX);
        for (let i = 0; i < want; i++) await db.insert(channelConnections).values(row(accountId));
        return 'ok' as const;
      }).catch((e: unknown) => {
        if ((e as { code?: string }).code === 'LIMIT_REACHED') return 'LIMIT_REACHED' as const;
        throw e;
      }),
    );
  }

  const usedOf = (accountId: string) =>
    withAccount(accountId, () =>
      tenantTx((db) => lockAndCountUsed(db, accountId, 'facebook_page')),
    );

  it('hai thẻ trình duyệt cùng chọn 3 Page khi còn 5 chỗ ⇒ đúng một bên thành công, tổng ≤ 5', async () => {
    const acc = await createAccount();
    const results = await Promise.all([tryConnect(acc, 3), tryConnect(acc, 3)]);
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'LIMIT_REACHED')).toHaveLength(1);
    expect(await usedOf(acc)).toBe(3);
  });

  it('nhiều lượt chèn đơn song song vượt giới hạn ⇒ không bao giờ quá N', async () => {
    const acc = await createAccount();
    const results = await Promise.all(Array.from({ length: 12 }, () => tryConnect(acc, 1)));
    expect(results.filter((r) => r === 'ok')).toHaveLength(MAX);
    expect(await usedOf(acc)).toBe(MAX);
  });

  it('ngắt trả chỗ ngay; "Cần kết nối lại" vẫn tính; nền tảng khác tính riêng', async () => {
    const acc = await createAccount();
    await tryConnect(acc, MAX);
    expect(await tryConnect(acc, 1)).toBe('LIMIT_REACHED');

    const ids = await withAccount(acc, () =>
      tenantTx((db) =>
        db
          .select({ id: channelConnections.id })
          .from(channelConnections)
          .orderBy(channelConnections.id),
      ),
    );
    // Một kết nối chuyển "cần kết nối lại" (vẫn chiếm chỗ), một kết nối ngắt (trả chỗ).
    await withAccount(acc, () =>
      tenantTx(async (db) => {
        await db
          .update(channelConnections)
          .set({ status: 'needs_reconnect', reason_code: 'TOKEN_EXPIRED' })
          .where(eq(channelConnections.id, ids[0]!.id));
        await db
          .update(channelConnections)
          .set({
            status: 'disconnected',
            disconnected_at: new Date(),
            token_ciphertext: null,
            refresh_ciphertext: null,
          })
          .where(eq(channelConnections.id, ids[1]!.id));
      }),
    );
    expect(await usedOf(acc)).toBe(MAX - 1);
    expect(await tryConnect(acc, 1)).toBe('ok');
    expect(await tryConnect(acc, 1)).toBe('LIMIT_REACHED');

    // Instagram đếm riêng với Facebook Page.
    const igUsed = await withAccount(acc, () =>
      tenantTx((db) => lockAndCountUsed(db, acc, 'instagram')),
    );
    expect(igUsed).toBe(0);
  });

  it('hai tài khoản không ảnh hưởng nhau (khóa theo tài khoản)', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await tryConnect(a, MAX);
    expect(await tryConnect(b, 1)).toBe('ok');
    expect(uuidV7()).toBeTruthy();
  });
});
