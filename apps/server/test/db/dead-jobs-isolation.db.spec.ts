// 003 T041, cổng CI số 1: cô lập tenant trên infra.dead_jobs – đọc/sửa/xóa/chèn chéo × 2 chiều.
import { randomUUID } from 'node:crypto';
import { deadJobs } from '../../src/modules/queue/internal/db/schema';
import { describeCrossTenant } from './helpers/cross-tenant';

describeCrossTenant({
  table: deadJobs,
  insertRow: () => ({
    id: randomUUID(),
    original_job_id: randomUUID(),
    queue: 'media',
    job_type: 'sandbox.isolation',
    payload_version: 1,
    payload: {},
    dedupe_key: `sandbox.isolation:${randomUUID()}`,
    cause: 'RETRIES_EXHAUSTED' as const,
    last_error: { name: 'Error', message: 'x' },
    attempts: 1,
    job_created_at: new Date(),
    trace_id: 't',
    generic_retry_allowed: true,
  }),
  updateRow: () => ({ attempts: 9 }),
});
