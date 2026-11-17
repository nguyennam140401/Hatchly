import { eq } from 'drizzle-orm';
import { accounts, currentAccountId, tenantTx } from '../../../core';

// Điều kiện đăng bài của tài khoản trong ngữ cảnh (013, ADR-12). Không cache (Hiến pháp: không cache hạn mức/quyền).
// Mô hình gói chi tiết chưa có ở `account` → `planActive` suy ra từ trạng thái tài khoản (`active`); gói hết hạn
// (`expired`) hoặc tạm dừng (`suspended`) → không đăng. `deleting` → đang xử lý yêu cầu xóa tài khoản.

export interface PublishingEligibility {
  planActive: boolean;
  deletionRequested: boolean;
}

export async function getPublishingEligibility(): Promise<PublishingEligibility> {
  const id = currentAccountId();
  if (id === null) throw new Error('Thiếu ngữ cảnh tài khoản (TENANT_CONTEXT_MISSING)');
  const rows = await tenantTx((db) =>
    db
      .select({ status: accounts.status, deletedAt: accounts.deleted_at })
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1),
  );
  const row = rows[0];
  if (row === undefined) return { planActive: false, deletionRequested: true };
  const deletionRequested = row.status === 'deleting' || row.deletedAt !== null;
  return { planActive: row.status === 'active', deletionRequested };
}
