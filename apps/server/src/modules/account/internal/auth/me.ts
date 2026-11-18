import type { MeResponse } from '@app/shared/auth';
import { and, eq } from 'drizzle-orm';
import { accounts, permissionsOf, tenantTx, type Db } from '../../../../core';
import { runInAccountScope } from '../../../../core/auth/account-scope';
import { memberships, users } from '../db/schema';

// Dựng `MeResponse` (contracts/auth-http-api.md mục 1) – không bao giờ có băm hay mã.
// `permissions` lấy từ danh mục quyền để web ẩn/hiện nút (API vẫn tự chặn).

export async function loadMeInTx(db: Db, userId: string): Promise<MeResponse | null> {
  const rows = await db
    .select({
      id: users.id,
      displayName: users.display_name,
      email: users.email,
      verifiedAt: users.email_verified_at,
      accountId: accounts.id,
      accountStatus: accounts.status,
      role: memberships.role,
    })
    .from(users)
    .innerJoin(accounts, eq(accounts.id, users.account_id))
    .innerJoin(
      memberships,
      and(eq(memberships.account_id, users.account_id), eq(memberships.user_id, users.id)),
    )
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    user: {
      id: row.id,
      displayName: row.displayName,
      email: row.email,
      emailVerified: row.verifiedAt !== null,
    },
    account: { id: row.accountId, status: row.accountStatus as MeResponse['account']['status'] },
    role: row.role,
    // 009: người ở tài khoản chờ giữ ghế chủ về mặt dữ liệu nhưng không có quyền nào.
    permissions: row.accountStatus === 'unclaimed' ? [] : permissionsOf(row.role),
  };
}

/** `MeResponse` của người dùng trong tài khoản đã xác minh. */
export function loadMe(accountId: string, userId: string): Promise<MeResponse | null> {
  return runInAccountScope(accountId, () => tenantTx((db) => loadMeInTx(db, userId)));
}
