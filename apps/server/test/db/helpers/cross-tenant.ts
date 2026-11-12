import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { DbPolicyViolationError } from '../../../src/core/db/errors';
import { tenantTx, type Db } from '../../../src/core/db/transaction';
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

export interface CrossTenantOptions<T extends PgTable, P = undefined> {
  table: T;
  /**
   * 006 R13 – tạo (hoặc lấy lại) dữ liệu CHA của một tài khoản cho bảng có FK nội bộ module (vd
   * `profile_versions → business_profiles`). Chạy trong tenantTx của tài khoản đó trước khi mồi;
   * kết quả truyền cho `insertRow`. Gọi lại ở mỗi ca → phải "lấy hoặc tạo".
   */
  seedParent?: (db: Db, accountId: string) => Promise<P>;
  /** Giá trị cho một dòng mới (không gồm id, account_id); `parent` là kết quả `seedParent`. */
  // eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- bảng chung chung T
  insertRow: (parent: P) => Partial<T['$inferInsert']>;
  /** Giá trị sửa một dòng (không gồm account_id). */
  // eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- bảng chung chung T
  updateRow: () => Partial<T['$inferInsert']>;
  /** Số dòng mồi mỗi tài khoản (mặc định 3). */
  rowsPerAccount?: number;
  /**
   * 006: bảng chỉ-thêm (vd lịch sử bất biến – REVOKE UPDATE, DELETE khỏi `app`): ca sửa/xóa chéo
   * khẳng định thao tác BỊ TỪ CHỐI và dữ liệu cả hai tài khoản nguyên vẹn. Ghi lý do.
   */
  appendOnly?: { reason: string };
  /**
   * 006: bảng có chỉ mục duy nhất theo `account_id` (tối đa 1 dòng/tài khoản, vd hồ sơ kinh doanh):
   * mồi 1 dòng/tài khoản; ca chèn chéo không chèn dòng hợp lệ trước (sẽ trùng khóa).
   */
  onePerAccount?: boolean;
}

export function describeCrossTenant<T extends PgTable, P = undefined>(
  options: CrossTenantOptions<T, P>,
): void {
  const config = getTableConfig(options.table);
  const qualified = `${config.schema ?? 'public'}.${config.name}`;
  const perAccount = options.onePerAccount === true ? 1 : (options.rowsPerAccount ?? 3);
  const tableAny = options.table as PgTable;

  describeDb(`Truy cập chéo tenant – ${qualified}`, () => {
    let database: TestDatabase;
    let a: string;
    let b: string;
    const parents = new Map<string, P>();

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
            const parent =
              options.seedParent === undefined
                ? (undefined as P)
                : await options.seedParent(db, owner);
            parents.set(owner, parent);
            for (let i = 0; i < perAccount; i++) {
              await db.insert(tableAny).values({ ...options.insertRow(parent), account_id: owner });
            }
          }),
        );
      }
    });
    const rowOf = (owner: string) => options.insertRow(parents.get(owner) as P);
    const appendOnly = options.appendOnly !== undefined;

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
        if (appendOnly) {
          await expect(
            withAccount(self, () => tenantTx((db) => db.update(tableAny).set(options.updateRow()))),
          ).rejects.toThrow();
          const counts = await countByAccount(qualified);
          expect(counts[self]).toBe(perAccount);
          expect(counts[pick(otherName)]).toBe(perAccount);
          return;
        }
        const updated = await withAccount(self, () =>
          tenantTx((db) => db.update(tableAny).set(options.updateRow()).returning()),
        );
        expect(updated).toHaveLength(perAccount);
        expect(updated.every((r) => (r as { account_id: string }).account_id === self)).toBe(true);
      });

      it(`${selfName}→${otherName}: xóa toàn bảng chỉ xóa dòng của ${selfName}`, async () => {
        const self = pick(selfName);
        const other = pick(otherName);
        if (appendOnly) {
          await expect(
            withAccount(self, () => tenantTx((db) => db.delete(tableAny))),
          ).rejects.toThrow();
          const counts = await countByAccount(qualified);
          expect(counts[self]).toBe(perAccount);
          expect(counts[other]).toBe(perAccount);
          return;
        }
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
              if (options.onePerAccount !== true) {
                await db.insert(tableAny).values({ ...rowOf(self), account_id: self });
              }
              await db.insert(tableAny).values({ ...rowOf(self), account_id: other });
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
        const attempt = expect(
          withAccount(self, () => tenantTx((db) => db.update(tableAny).set({ account_id: other }))),
        ).rejects;
        // Bảng chỉ-thêm: bị chặn bởi quyền (REVOKE) trước cả chính sách RLS.
        await (appendOnly ? attempt.toThrow() : attempt.toBeInstanceOf(DbPolicyViolationError));
        const counts = await countByAccount(qualified);
        expect(counts[self]).toBe(perAccount);
        expect(counts[other]).toBe(perAccount);
      });
    }
  });
}
