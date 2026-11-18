// T012 (009, SC-007, FR-031): cô lập lời mời và thành viên cũ giữa các tài khoản.
// Khuôn truy cập chéo chung chạy ở cross-tenant-coverage.db.spec.ts (fixture `account.invitations`,
// `account.former_members`); tệp này kiểm thêm các tình huống riêng của 009: không ngữ cảnh → 0 dòng,
// mã lời mời/người dùng của tài khoản khác không đổi được gì, và hàm tra lời mời không trả dữ liệu
// ngoài các cột hợp đồng.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { tenantTx } from '../../src/core/db/transaction';
import { formerMembers, invitations } from '../../src/modules/account/internal/db/schema';
import {
  asOwner,
  describeDb,
  makeDatabase,
  rawAppPool,
  withAccount,
  type TestDatabase,
} from './helpers/db';
import {
  callDetach,
  markVerified,
  seedCollaborator,
  seedInvitation,
  seedUser,
  type SeededInvitation,
  type SeededUser,
} from './helpers/auth-seed';

describeDb('Cô lập lời mời và thành viên cũ (009)', () => {
  let database: TestDatabase;
  let a: SeededUser;
  let b: SeededUser;
  let invOfB: SeededInvitation;
  let formerOfB: string;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 4 });
    a = await seedUser();
    b = await seedUser();
    await markVerified(a.userId);
    await markVerified(b.userId);
    await seedInvitation(a, { seat: 1 });
    invOfB = await seedInvitation(b, { seat: 1 });
    const gone = await seedCollaborator(b, { seat: 2 });
    await callDetach(b.accountId, gone.userId, b.userId);
    formerOfB = gone.userId;
  });
  afterAll(async () => {
    await database.close();
  });

  it('vai trò app không đặt ngữ cảnh tenant → 0 dòng ở cả hai bảng', async () => {
    const pool = rawAppPool();
    try {
      for (const table of ['account.invitations', 'account.former_members']) {
        const r = await pool.query(`SELECT * FROM ${table}`);
        expect(r.rowCount, table).toBe(0);
      }
    } finally {
      await pool.end();
    }
  });

  it('trong ngữ cảnh A: không đọc, sửa, xóa được lời mời của B dù biết đúng mã', async () => {
    await withAccount(a.accountId, () =>
      tenantTx(async (db) => {
        const seen = await db.select({ id: invitations.id }).from(invitations);
        expect(seen).toHaveLength(1);
        const read = await db
          .select({ id: invitations.id })
          .from(invitations)
          .where(eq(invitations.id, invOfB.invitationId));
        expect(read).toHaveLength(0);
        const updated = await db
          .update(invitations)
          .set({ status: 'cancelled', closed_at: new Date() })
          .where(and(eq(invitations.id, invOfB.invitationId), eq(invitations.status, 'pending')))
          .returning({ id: invitations.id });
        expect(updated).toHaveLength(0);
        const deleted = await db
          .delete(invitations)
          .where(eq(invitations.id, invOfB.invitationId))
          .returning({ id: invitations.id });
        expect(deleted).toHaveLength(0);
      }),
    );
    const still = await asOwner((c) =>
      c.query<{ status: string }>('SELECT status FROM account.invitations WHERE id = $1', [
        invOfB.invitationId,
      ]),
    );
    expect(still.rows[0]?.status).toBe('pending');
  });

  it('trong ngữ cảnh A: không thấy, không sửa được thành viên cũ của B', async () => {
    await withAccount(a.accountId, () =>
      tenantTx(async (db) => {
        expect(await db.select({ id: formerMembers.id }).from(formerMembers)).toHaveLength(0);
        const updated = await db
          .update(formerMembers)
          .set({ display_name: 'đổi' })
          .where(eq(formerMembers.user_id, formerOfB))
          .returning({ id: formerMembers.id });
        expect(updated).toHaveLength(0);
      }),
    );
    await withAccount(b.accountId, () =>
      tenantTx(async (db) => {
        const rows = await db.select({ userId: formerMembers.user_id }).from(formerMembers);
        expect(rows).toEqual([{ userId: formerOfB }]);
      }),
    );
  });

  it('member_detach trong ngữ cảnh A với người dùng của B → not_found, không đổi gì', async () => {
    const victim = await seedCollaborator(b, { seat: 2 });
    const { result, shellAccountId } = await callDetach(a.accountId, victim.userId, a.userId);
    expect(result).toBe('not_found');
    const rows = await asOwner((c) =>
      c.query<{ account_id: string; shell: string }>(
        `SELECT u.account_id,
                (SELECT count(*)::text FROM account.accounts WHERE id = $2) AS shell
           FROM account.users u WHERE u.id = $1`,
        [victim.userId, shellAccountId],
      ),
    );
    expect(rows.rows).toEqual([{ account_id: b.accountId, shell: '0' }]);
  });
});
