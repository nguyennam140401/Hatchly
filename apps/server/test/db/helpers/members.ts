import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { asOwner } from './db';

// 005: mồi thành viên tài khoản bằng `owner` (không qua luồng đăng ký) – người nhận thông báo.

/** Mồi một người dùng + tư cách thành viên (bằng `owner`). */
export async function seedMember(
  accountId: string,
  opts: {
    role: 'owner' | 'collaborator';
    seat: number;
    status?: 'active' | 'removed' | 'disabled';
    userStatus?: 'active' | 'disabled';
    name?: string;
  },
): Promise<{ userId: string; email: string }> {
  const userId = uuidV7();
  const email = `${opts.role}-${userId.slice(-8)}@example.test`;
  await asOwner(async (c) => {
    await c.query(
      `INSERT INTO account.users (id, account_id, display_name, email, email_normalized, status,
         terms_version, terms_accepted_at) VALUES ($1, $2, $3, $4, $4, $5, '2026-11', now())`,
      [userId, accountId, opts.name ?? opts.role, email, opts.userStatus ?? 'active'],
    );
    await c.query(
      `INSERT INTO account.memberships (id, account_id, user_id, role, seat, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidV7(), accountId, userId, opts.role, opts.seat, opts.status ?? 'active'],
    );
  });
  return { userId, email };
}

/** Gỡ thành viên (như thao tác của account – trạng thái `removed`). */
export async function removeSeededMember(userId: string): Promise<void> {
  await asOwner((c) =>
    c.query("UPDATE account.memberships SET status = 'removed' WHERE user_id = $1", [userId]),
  );
}
