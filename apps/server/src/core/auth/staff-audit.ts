import { getExecutionContext } from '../context/request-context';
import { auditLog } from '../db/audit-log.log-table';
import { authTx } from '../db/auth-tx';

// Kiểm toán thao tác của nhân viên nội bộ ở lớp lõi (FR-018, R10, nguyên tắc VIII): từ chối do
// địa chỉ mạng/quyền ở guard, và mọi yêu cầu nội bộ thay đổi dữ liệu (interceptor). metadata KHÔNG
// chứa email, mật khẩu, mã hay thân yêu cầu.

export interface StaffRequestAudit {
  staffId: string;
  role: 'support' | 'admin';
  ip: string;
  uaFamily: string | null;
  method: string;
  /** Route mẫu (vd `/api/v1/internal/x/:id`), không phải đường dẫn thật có tham số. */
  route: string;
  /** `ok` | `error` | `denied_ip` | `forbidden`. */
  result: string;
}

export async function writeStaffRequestAudit(entry: StaffRequestAudit): Promise<void> {
  await authTx(async (db) => {
    await db.insert(auditLog).values({
      actor_type: entry.role,
      actor_id: entry.staffId,
      action: 'staff.request',
      trace_id: getExecutionContext()?.traceId ?? null,
      metadata: {
        ip: entry.ip,
        ua_family: entry.uaFamily,
        reason: entry.result === 'ok' ? null : entry.result,
        method: entry.method,
        route: entry.route,
        result: entry.result,
      },
    });
  });
}
