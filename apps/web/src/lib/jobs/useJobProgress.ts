import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useApiQuery } from '../api/hooks';
import { queryKeys, type QueryKey } from '../api/query-keys';

// Tiến độ việc nền (FR-030): KHÔNG có kênh đẩy và KHÔNG làm mới nền định kỳ chung. Chỉ làm mới mỗi `JOB_POLL_MS` khi
// (1) có thành phần đang gắn, (2) tab đang hiển thị, (3) việc còn `running`; dừng sau 5 phút. Kết thúc → vô hiệu hóa theo thao tác
// đã tạo việc; thông báo hoàn tất đến qua `notifications.unread` ở lần làm mới sau.

export const JOB_POLL_MS = 3000;
export const JOB_POLL_MAX_MS = 5 * 60 * 1000;

export interface JobProgress {
  jobId: string;
  kind: string;
  done: number;
  total: number;
  state: 'running' | 'succeeded' | 'partial' | 'failed';
  subjectRef?: { type: string; id: string };
}

export interface UseJobProgressOptions {
  /** Đọc tiến độ từ điểm cuối do tính năng sinh việc khai báo. */
  fetch: (jobId: string) => Promise<JobProgress>;
  enabled?: boolean;
  /** Khóa cần làm mới khi việc kết thúc (theo thao tác tạo việc). */
  invalidateOnFinish?: QueryKey[];
  onFinished?: (progress: JobProgress) => void;
}

export function useJobProgress(
  jobId: string,
  options: UseJobProgressOptions,
): { progress: JobProgress | undefined; isRunning: boolean } {
  const { fetch, enabled = true, invalidateOnFinish, onFinished } = options;
  const client = useQueryClient();
  const startedAt = useRef<number | null>(null);
  const query = useApiQuery(queryKeys.jobs.detail(jobId), () => fetch(jobId), {
    freshness: 'volatile',
    enabled,
  });
  const progress = query.data;
  const isRunning = progress?.state === 'running';
  const { refetch } = query;

  // Làm mới có điều kiện.
  useEffect(() => {
    if (!enabled || !isRunning) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - (startedAt.current ?? Date.now()) > JOB_POLL_MAX_MS) return;
      void refetch();
    };
    startedAt.current ??= Date.now();
    const timer = setInterval(tick, JOB_POLL_MS);
    // Quay lại tab: làm mới ngay một lần thay vì chờ chu kỳ kế.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, isRunning, refetch]);

  // Kết thúc → vô hiệu hóa theo thao tác tạo việc (một lần).
  const finished = useRef(false);
  useEffect(() => {
    if (progress === undefined || progress.state === 'running' || finished.current) return;
    finished.current = true;
    for (const key of invalidateOnFinish ?? []) void client.invalidateQueries({ queryKey: key });
    onFinished?.(progress);
  }, [progress, client, invalidateOnFinish, onFinished]);

  return { progress, isRunning };
}
