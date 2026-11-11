import { and, asc, eq } from 'drizzle-orm';
import { tenantTx } from '../../../core';
import { memberships, users } from './db/schema';

// Danh bạ thành viên của tài khoản trong ngữ cảnh (005, R9 – người nhận thông báo). Đọc qua tenantTx
// (RLS): chỉ thấy thành viên của tài khoản hiện tại; thành viên đã gỡ/khóa hoặc người dùng bị khóa bị
// loại. Không phụ thuộc phần xác thực nên dùng được ở cả API và Worker (hàng chờ `notify`).

export interface ActiveMember {
  userId: string;
  role: 'owner' | 'collaborator';
  email: string;
  displayName: string;
}

export async function listActiveMembers(): Promise<ActiveMember[]> {
  return tenantTx(async (db) => {
    const rows = await db
      .select({
        userId: users.id,
        role: memberships.role,
        email: users.email,
        displayName: users.display_name,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.user_id))
      .where(and(eq(memberships.status, 'active'), eq(users.status, 'active')))
      .orderBy(asc(memberships.seat));
    return rows;
  });
}
