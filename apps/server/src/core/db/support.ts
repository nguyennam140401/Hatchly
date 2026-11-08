import { ERROR_CODES } from '@app/shared/core';
import { getExecutionContext } from '../context/request-context';
import { AppError } from '../errors/app-error';
import { auditLog } from './audit-log.log-table';
import { activeDatabase } from './database';
import { TenantContextError } from './errors';
import type { RolePool } from './pools';
import { currentTx, runTx, type Db } from './transaction';

// Ngữ cảnh hỗ trợ (FR-023, research R11): bể `support`, chỉ đọc khung nhìn đã lọc. Mỗi lần gọi ghi
// ĐÚNG một dòng infra.audit_log TRƯỚC khi chạy `fn`, trong cùng giao dịch – `fn` lỗi thì không có
// cả kết quả lẫn dòng kiểm toán "mồ côi" (SC-007).

export interface SupportActor {
  /** Mã nhân viên nội bộ (bảng nhân viên – đầu việc sau). */
  staffId: string;
}

const MIN_REASON_LENGTH = 5;

function supportPool(): RolePool {
  const pool = activeDatabase().pool('support');
  if (pool === undefined) {
    throw new AppError({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      httpStatus: 503,
      message: 'Chức năng tra cứu hỗ trợ đang tạm ngưng. Vui lòng thử lại sau.',
      actions: [{ kind: 'retry', label: 'Thử lại' }],
      detail: 'SUPPORT_DB_NOT_CONFIGURED',
    });
  }
  return pool;
}

function assertNotNested(): void {
  if (currentTx() !== undefined) throw new TenantContextError('TENANT_CONTEXT_CONFLICT');
}

const traceId = () => getExecutionContext()?.traceId ?? null;

/**
 * Tìm kiếm xuyên tài khoản qua khung nhìn tìm kiếm (chỉ mã tài khoản, mã đối tượng, trạng thái).
 * Kiểm toán ghi LOẠI từ khóa, không bao giờ ghi giá trị từ khóa.
 */
export async function supportSearch<T>(
  actor: SupportActor,
  keywordType: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const pool = supportPool();
  assertNotNested();
  return runTx(pool, 'support', null, fn, {
    guard: true,
    before: async (db) => {
      await db.insert(auditLog).values({
        actor_type: 'support',
        actor_id: actor.staffId,
        action: 'support.search',
        keyword_type: keywordType,
        trace_id: traceId(),
      });
    },
  });
}

/**
 * Xem chi tiết MỘT tài khoản qua khung nhìn chi tiết. `accountId` từ tham số là ngoại lệ có chủ đích
 * (nhân viên chọn tài khoản) – chỉ ở bể `support`, luôn kèm lý do và kiểm toán (hiến pháp I).
 */
export async function supportViewAccount<T>(
  actor: SupportActor,
  accountId: string,
  reason: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  if (reason.trim().length < MIN_REASON_LENGTH) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_FAILED,
      httpStatus: 400,
      message: `Vui lòng nhập lý do xem dữ liệu (ít nhất ${MIN_REASON_LENGTH} ký tự).`,
      actions: [{ kind: 'fix_input', label: 'Nhập lý do' }],
    });
  }
  const pool = supportPool();
  assertNotNested();
  return runTx(pool, 'support', accountId, fn, {
    existsCheck: 'account_exists',
    guard: false,
    before: async (db) => {
      await db.insert(auditLog).values({
        account_id: accountId,
        actor_type: 'support',
        actor_id: actor.staffId,
        action: 'support.view_account',
        reason: reason.trim(),
        trace_id: traceId(),
      });
    },
  });
}
