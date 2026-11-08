// US3-AS5, FR-019: hai người cùng sửa một phiên bản → đúng một thành công, một VERSION_CONFLICT.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors/app-error';
import { tenantTx } from '../../src/core/db/transaction';
import { updateVersioned } from '../../src/core/db/versioned';
import { accounts } from '../../src/core/db/tenant-root';
import {
  createAccount,
  describeDb,
  makeDatabase,
  seedNotes,
  withAccount,
  type TestDatabase,
} from './helpers/db';
import { tenantNotes } from './sandbox/schema';

describeDb('Khóa lạc quan – updateVersioned', () => {
  let database: TestDatabase;
  let a: string;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 3 });
    a = await createAccount();
  });
  afterAll(async () => {
    await database.close();
  });

  it('hai tenantTx song song cùng expectedVersion 1 → một version 2, một 409 VERSION_CONFLICT', async () => {
    const [id] = await seedNotes(a, 1);
    const attempt = (title: string) =>
      withAccount(a, () =>
        tenantTx(async (db) => {
          const row = await updateVersioned(
            db,
            tenantNotes,
            { id: id!, expectedVersion: 1 },
            { title },
          );
          // Giữ giao dịch mở một chút để hai bên thực sự chồng nhau.
          await db.execute(sql`SELECT pg_sleep(0.05)`);
          return row;
        }),
      );
    const results = await Promise.allSettled([attempt('người 1'), attempt('người 2')]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((ok[0] as PromiseFulfilledResult<{ version: number }>).value.version).toBe(2);
    const err = failed[0]!.reason as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('VERSION_CONFLICT');
    expect(err.httpStatus).toBe(409);
    expect(err.message).toBe('Bài vừa được người khác sửa. Tải lại để xem bản mới nhất.');
    expect(err.actions[0]).toEqual({ kind: 'retry', label: 'Tải lại' });
  });

  it('bảng không có cột version → lỗi lúc gọi', async () => {
    await expect(
      withAccount(a, () =>
        tenantTx((db) =>
          updateVersioned(
            db,
            accounts as never,
            { id: a, expectedVersion: 1 },
            { status: 'active' },
          ),
        ),
      ),
    ).rejects.toThrow(/version/);
  });
});
