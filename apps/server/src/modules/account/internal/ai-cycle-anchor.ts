import { eq } from 'drizzle-orm';
import { accounts, currentAccountId, tenantTx } from '../../../core';
import type { AiCycleAnchor } from '../public-api';

// Mốc chu kỳ AI của tài khoản trong ngữ cảnh (015, R-05, contracts/ai-gateway-delta.md mục 4). Không cache
// (Hiến pháp: không cache ngân sách/hạn mức). Hiện thực TẠM: chưa có mô hình gói/cột kích hoạt → mốc là ngày tạo
// (UTC+7) của tài khoản `active`; trạng thái khác, đã đánh dấu xóa hoặc không có dòng → `null` (Cổng AI từ chối như
// hết hạn mức). Khi có mô hình gói, chỉ đổi bên trong hàm này.

const VN_OFFSET_MS = 7 * 3_600_000;

export async function getAiCycleAnchor(): Promise<AiCycleAnchor | null> {
  const id = currentAccountId();
  if (id === null) throw new Error('Thiếu ngữ cảnh tài khoản (TENANT_CONTEXT_MISSING)');
  const rows = await tenantTx((db) =>
    db
      .select({
        status: accounts.status,
        createdAt: accounts.created_at,
        deletedAt: accounts.deleted_at,
      })
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1),
  );
  const row = rows[0];
  if (row?.status !== 'active' || row.deletedAt !== null) return null;
  const anchorDate = new Date(row.createdAt.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
  return { anchorDate };
}
