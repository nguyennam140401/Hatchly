import type { Pool } from 'pg';
import { JOB_TABLE } from '../producer';

// Thao tác trực tiếp lên bảng của pg-boss, gom một chỗ để nâng phiên bản chỉ phải kiểm một tệp (hiến pháp IX).
// Khi nâng pg-boss: chạy lại test/queue/unknown-job-type.queue.spec.ts.

/**
 * Trả một việc `active` về hàng chờ KHÔNG tăng `retry_count` (R22): đặt `retry`, giờ chạy lùi `seconds` giây và
 * bỏ dấu "đã bắt đầu" (pg-boss 12 chỉ tăng `retry_count` khi nhận việc có `started_on`). Rào theo lượt: chỉ ghi khi
 * việc còn `active` đúng ở `retryCount` đã lấy. Trả `true` nếu ghi được.
 */
export async function requeueActiveJob(
  pool: Pool,
  job: { id: string; retryCount: number },
  queue: string,
  seconds: number,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE ${JOB_TABLE}
        SET state = 'retry', start_after = now() + make_interval(secs => $4), started_on = NULL, heartbeat_on = NULL
      WHERE id = $1 AND name = $2 AND state = 'active' AND retry_count = $3`,
    [job.id, queue, job.retryCount, seconds],
  );
  return (result.rowCount ?? 0) > 0;
}
