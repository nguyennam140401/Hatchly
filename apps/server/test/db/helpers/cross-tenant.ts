import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { DbPolicyViolationError } from '../../../src/core/db/errors';
import { tenantTx } from '../../../src/core/db/transaction';
import {
  asOwner,
  countByAccount,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from './db';

// Khuôn kiểm thử truy cập chéo TÁI SỬ DỤNG (FR-025, cổng CI số 1): với một bảng `tenant`, đăng nhập
// tài khoản A thử đọc/sửa/xóa/chèn dữ liệu tài khoản B → phải thất bại; cả hai chiều A→B, B→A.
// WBS 1.4 gọi khuôn này cho mọi bảng khách hàng mới.

export interface CrossTenantOptions<T extends PgTable> {
  table: T;
  /** Giá trị cho một dòng mới (không gồm id, account_id). */
  // eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- bảng chung chung T
  insertRow: () => Partial<T['$inferInsert']>;
  /** Giá trị sửa một dòng (không gồm account_id). */
  // eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- bảng chung chung T
  updateRow: () => Partial<T['$inferInsert']>;
  /** Số dòng mồi mỗi tài khoản (mặc định 3). */
  rowsPerAccount?: number;
}

export function describeCrossTenant<T extends PgTable>(options: CrossTenantOptions<T>): void {
  const config = getTableConfig(options.table);
  const qualified = `${config.schema ?? 'public'}.${config.name}`;
  const perAccount = options.rowsPerAccount ?? 3;
  const tableAny = options.table as PgTable;

  describeDb(`Truy cập chéo tenant – ${qualified}`, () => {
    let database: TestDatabase;
    let a: string;
    let b: string;

    beforeAll(async () => {
      database = makeDatabase();
      a = await createAccount();
      b = await createAccount();
    });
    afterAll(async () => {
      await database.close();
    });

    beforeEach(async () => {
      // Mồi lại dữ liệu mỗi ca bằng owner (không bị RLS) qua chính Drizzle-insert của bảng.
      await asOwner(async (c) => {
        await c.query(`DELETE FROM ${qualified} WHERE account_id = ANY($1)`, [[a, b]]);
      });
      for (const owner of [a, b]) {
        await withAccount(owner, () =>
          tenantTx(async (db) => {
            for (let i = 0; i < perAccount; i++) {
              await db.insert(tableAny).values({ ...options.insertRow(), account_id: owner });
            }
          }),
        );
      }
    });

    const directions = [
      ['A', 'B'],
      ['B', 'A'],
    ] as const;

    for (const [selfName, otherName] of directions) {
      const pick = (name: 'A' | 'B') => (name === 'A' ? a : b);

      it(`${selfName}→${otherName}: đọc toàn bảng không lọc chỉ thấy dòng của ${selfName}`, async () => {
        const self = pick(selfName);
        const rows = await withAccount(self, () => tenantTx((db) => db.select().from(tableAny)));
        expect(rows).toHaveLength(perAccount);
        expect(new Set(rows.map((r) => (r as { account_id: string }).account_id))).toEqual(
          new Set([self]),
        );
      });

      it(`${selfName}→${otherName}: sửa toàn bảng chỉ chạm dòng của ${selfName}`, async () => {
        const self = pick(selfName);
        const updated = await withAccount(self, () =>
          tenantTx((db) => db.update(tableAny).set(options.updateRow()).returning()),
        );
        expect(updated).toHaveLength(perAccount);
        expect(updated.every((r) => (r as { account_id: string }).account_id === self)).toBe(true);
      });

      it(`${selfName}→${otherName}: xóa toàn bảng chỉ xóa dòng của ${selfName}`, async () => {
        const self = pick(selfName);
        const other = pick(otherName);
        await withAccount(self, () => tenantTx((db) => db.delete(tableAny)));
        const counts = await countByAccount(qualified);
        expect(counts[self] ?? 0).toBe(0);
        expect(counts[other]).toBe(perAccount);
      });

      it(`${selfName}→${otherName}: chèn dòng account_id = ${otherName} → DB_POLICY_VIOLATION, hoàn tác`, async () => {
        const self = pick(selfName);
        const other = pick(otherName);
        await expect(
          withAccount(self, () =>
            tenantTx(async (db) => {
              await db.insert(tableAny).values({ ...options.insertRow(), account_id: self });
              await db.insert(tableAny).values({ ...options.insertRow(), account_id: other });
            }),
          ),
        ).rejects.toBeInstanceOf(DbPolicyViolationError);
        const counts = await countByAccount(qualified);
        // Dòng hợp lệ chèn trước cũng bị hoàn tác cùng giao dịch.
        expect(counts[self]).toBe(perAccount);
        expect(counts[other]).toBe(perAccount);
      });

      it(`${selfName}→${otherName}: sửa thành account_id = ${otherName} → DB_POLICY_VIOLATION, dòng ${otherName} nguyên vẹn`, async () => {
        const self = pick(selfName);
        const other = pick(otherName);
        await expect(
          withAccount(self, () => tenantTx((db) => db.update(tableAny).set({ account_id: other }))),
        ).rejects.toBeInstanceOf(DbPolicyViolationError);
        const counts = await countByAccount(qualified);
        expect(counts[self]).toBe(perAccount);
        expect(counts[other]).toBe(perAccount);
      });
    }
  });
}
