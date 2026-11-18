// Bộ đếm dung lượng 5 GB (014 T061, FR-008/028, SC-005, SC-009, hiến pháp III-V): giữ chỗ bằng UPDATE có điều kiện nên KHÔNG BAO
// GIỜ vượt trần dù nhiều yêu cầu cùng lúc; chốt / trả giữ chỗ / trả dung lượng chạy lại không âm; CHECK là chốt chặn cuối.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { tenantTx } from '../../src/core/db/transaction';
import { QuotaExceededError, QuotaStore } from '../../src/modules/media/internal/quota.store';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from './helpers/db';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

describeDb('Bộ đếm dung lượng media – đồng thời và hoàn dung lượng', () => {
  let database: TestDatabase;
  const quota = new QuotaStore(5 * GIB);

  beforeAll(() => {
    database = makeDatabase({ poolMax: 24 });
  });
  afterAll(async () => {
    await database.close();
  });

  const row = async (accountId: string) =>
    asOwner(async (c) => {
      const r = await c.query<{ used: string; reserved: string; limit: string }>(
        `SELECT used_bytes::text AS used, reserved_bytes::text AS reserved, limit_bytes::text AS limit
           FROM media.storage_quotas WHERE account_id = $1`,
        [accountId],
      );
      const v = r.rows[0];
      return v === undefined
        ? null
        : { used: Number(v.used), reserved: Number(v.reserved), limit: Number(v.limit) };
    });

  const tx = <T>(
    accountId: string,
    fn: (db: Parameters<Parameters<typeof tenantTx>[0]>[0]) => Promise<T>,
  ) => withAccount(accountId, () => tenantTx(fn));

  it('25 yêu cầu giữ chỗ 400 MiB SONG SONG khi trần 5 GiB ⇒ đúng 12 thành công, tổng không bao giờ vượt trần (SC-005)', async () => {
    const acc = await createAccount();
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () => tx(acc, (db) => quota.reserve(db, 400 * MIB))),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(ok).toBe(12); // floor(5 GiB / 400 MiB) = 12
    expect(rejected).toHaveLength(13);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(QuotaExceededError);
    const q = (await row(acc))!;
    expect(q.reserved).toBe(12 * 400 * MIB);
    expect(q.used + q.reserved).toBeLessThanOrEqual(q.limit);
  });

  it('lỗi hết chỗ kèm số liệu hiện tại để báo "Thư viện đã đầy (x/5 GB)"', async () => {
    const acc = await createAccount();
    await tx(acc, (db) => quota.reserve(db, 5 * GIB));
    const err = await tx(acc, (db) => quota.reserve(db, 1)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect((err as QuotaExceededError).quota).toMatchObject({
      reservedBytes: 5 * GIB,
      state: 'full',
      percent: 100,
    });
  });

  it('giữ chỗ rồi hoàn tác giao dịch (lỗi SAU khi giữ) ⇒ không mất dung lượng', async () => {
    const acc = await createAccount();
    await expect(
      tx(acc, async (db) => {
        await quota.reserve(db, GIB);
        throw new Error('lỗi giả lập sau khi giữ chỗ');
      }),
    ).rejects.toThrow('lỗi giả lập');
    expect((await row(acc))?.reserved ?? 0).toBe(0);
  });

  it('vòng đời đầy đủ: giữ chỗ → chốt → trả; mỗi bước CHẠY LẠI không làm âm hay trả hai lần', async () => {
    const acc = await createAccount();
    const D = 300 * MIB;
    await tx(acc, (db) => quota.reserve(db, D));
    expect(await tx(acc, (db) => quota.commit(db, D, D))).toBe(true);
    expect(await row(acc)).toMatchObject({ used: D, reserved: 0 });
    // chốt lại lần hai: không còn chỗ giữ ⇒ bỏ qua
    expect(await tx(acc, (db) => quota.commit(db, D, D))).toBe(false);
    expect(await row(acc)).toMatchObject({ used: D, reserved: 0 });
    // trả dung lượng (xóa / trùng / không xử lý được) – chỉ một lần có hiệu lực khi người gọi kiểm trạng thái trước
    expect(await tx(acc, (db) => quota.refundUsed(db, D))).toBe(true);
    expect(await tx(acc, (db) => quota.refundUsed(db, D))).toBe(false); // used = 0 < D ⇒ bỏ qua, không âm
    expect(await row(acc)).toMatchObject({ used: 0, reserved: 0 });
    // trả giữ chỗ chạy lại
    await tx(acc, (db) => quota.reserve(db, D));
    expect(await tx(acc, (db) => quota.releaseReservation(db, D))).toBe(true);
    expect(await tx(acc, (db) => quota.releaseReservation(db, D))).toBe(false);
    expect(await row(acc)).toMatchObject({ used: 0, reserved: 0 });
  });

  it('nhiều lần trả giữ chỗ SONG SONG chỉ trả đúng một lần (SC-009: hoàn dung lượng sau hủy/lỗi/hết hạn)', async () => {
    const acc = await createAccount();
    const D = 500 * MIB;
    await tx(acc, (db) => quota.reserve(db, D));
    const r = await Promise.all(
      Array.from({ length: 10 }, () => tx(acc, (db) => quota.releaseReservation(db, D))),
    );
    expect(r.filter(Boolean)).toHaveLength(1);
    expect((await row(acc))!.reserved).toBe(0);
  });

  it('chưa có dòng ⇒ read trả 0/0/5 GiB; giữ chỗ tự tạo dòng với trần mặc định', async () => {
    const acc = await createAccount();
    expect(await tx(acc, (db) => quota.read(db))).toMatchObject({
      usedBytes: 0,
      reservedBytes: 0,
      limitBytes: 5 * GIB,
      percent: 0,
      state: 'ok',
    });
    await tx(acc, (db) => quota.reserve(db, GIB));
    expect(await row(acc)).toMatchObject({ reserved: GIB, limit: 5 * GIB });
  });

  it('CHỐT CHẶN CUỐI: UPDATE trực tiếp làm vượt trần hoặc âm bị CSDL từ chối (CHECK), dù code có lỗi', async () => {
    const acc = await createAccount();
    await tx(acc, (db) => quota.reserve(db, 4 * GIB));
    await expect(
      asOwner((c) =>
        c.query(
          'UPDATE media.storage_quotas SET reserved_bytes = reserved_bytes + $2 WHERE account_id = $1',
          [acc, 2 * GIB],
        ),
      ),
    ).rejects.toThrow(/storage_quotas_within_limit/);
    await expect(
      asOwner((c) =>
        c.query('UPDATE media.storage_quotas SET used_bytes = -1 WHERE account_id = $1', [acc]),
      ),
    ).rejects.toThrow(/storage_quotas_within_limit/);
  });

  it('hai tài khoản có bộ đếm riêng: giữ chỗ của A không ảnh hưởng B (I)', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await tx(a, (db) => quota.reserve(db, 5 * GIB));
    await expect(tx(a, (db) => quota.reserve(db, 1))).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(tx(b, (db) => quota.reserve(db, 5 * GIB))).resolves.toBeUndefined();
  });
});
