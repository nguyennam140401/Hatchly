import { eq, inArray } from 'drizzle-orm';
import { tenantTx } from '../../../../core';
import { memberships, users } from '../db/schema';

// Tên hiển thị + trạng thái thành viên cho module khác (006 contracts/context-public-api.md mục 3).
// Chạy trong tenantTx CỦA NGƯỜI GỌI (dùng lại giao dịch nếu đang mở) – không nhận accountId: RLS chỉ
// trả người dùng của tài khoản trong ngữ cảnh, mã của tài khoản khác/không tồn tại tự vắng mặt.

export type MemberStatus = 'active' | 'removed' | 'disabled';

export interface MemberDescription {
  userId: string;
  displayName: string;
  status: MemberStatus;
}

/** Trần số mã mỗi lần gọi (trang lịch sử 20 dòng). */
export const DESCRIBE_MEMBERS_MAX = 100;

export async function describeMembers(userIds: readonly string[]): Promise<MemberDescription[]> {
  if (userIds.length > DESCRIBE_MEMBERS_MAX) {
    throw new Error(`describeMembers nhận tối đa ${DESCRIBE_MEMBERS_MAX} mã mỗi lần`);
  }
  const ids = [...new Set(userIds)];
  // Không ngữ cảnh tenant → tenantTx ném TENANT_CONTEXT_MISSING, kể cả khi danh sách rỗng.
  return tenantTx(async (db) => {
    if (ids.length === 0) return [];
    const rows = await db
      .select({
        userId: users.id,
        displayName: users.display_name,
        userStatus: users.status,
        memberStatus: memberships.status,
      })
      .from(users)
      .leftJoin(memberships, eq(memberships.user_id, users.id))
      .where(inArray(users.id, ids));
    return rows.map((r) => ({
      userId: r.userId,
      displayName: r.displayName,
      status: toStatus(r.memberStatus, r.userStatus),
    }));
  });
}

function toStatus(
  member: 'active' | 'removed' | 'disabled' | null,
  user: 'active' | 'disabled',
): MemberStatus {
  if (member === null || member === 'removed') return 'removed';
  if (member === 'disabled' || user === 'disabled') return 'disabled';
  return 'active';
}
