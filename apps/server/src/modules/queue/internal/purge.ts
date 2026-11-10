// Xóa mọi việc + việc hỏng của MỘT tài khoản (research R15, FR-037, Clarifications Q3) – luồng xóa tài
// khoản ở Worker gọi trong systemTx({ tenant: 'from-context' }). Việc đang chạy bị xóa: heartbeat kế tiếp
// báo 0 dòng → bộ xử lý bị hủy, không ghi kết quả, không thử lại. Idempotent.
import { auditLog } from '../../../core/db/audit-log.log-table';
import { deadJobs } from './db/schema';
import { queueError } from './errors';
import { requireCurrentTx } from './pgboss/tx-database';
import { JOB_TABLE } from './producer';

export async function purgeAccountJobs(): Promise<{ jobs: number; deadJobs: number }> {
  const tx = currentSystemTenantTx();
  const db = tx.db;
  const jobs = await db.$client.query(
    `DELETE FROM ${JOB_TABLE} WHERE group_id = account.current_account_id()::text`,
  );
  // RLS (system_scoped) chỉ cho thấy dòng của tài khoản trong ngữ cảnh.
  const dead = await db.delete(deadJobs).returning({ id: deadJobs.id });
  const counts = { jobs: jobs.rowCount ?? 0, deadJobs: dead.length };
  await db.insert(auditLog).values({
    account_id: tx.accountId,
    actor_type: 'system',
    actor_id: 'queue.purge_account_jobs',
    action: 'queue.account_jobs_purged',
    // Chỉ số lượng – không dữ liệu cá nhân (hiến pháp VII).
    metadata: { jobs: counts.jobs, dead_jobs: counts.deadJobs },
  });
  return counts;
}

function currentSystemTenantTx() {
  let tx;
  try {
    tx = requireCurrentTx();
  } catch {
    throw queueError('QUEUE_SYSTEM_TENANT_CONTEXT_REQUIRED');
  }
  if (tx.role !== 'system' || tx.accountId === null) {
    throw queueError('QUEUE_SYSTEM_TENANT_CONTEXT_REQUIRED');
  }
  return tx;
}
