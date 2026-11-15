import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { AppError } from './errors';

// Lớp làm mới theo loại dữ liệu (data-model mục 4). `volatile`/`session` KHÔNG giữ cache (hiến pháp: không cache ngân
// sách AI, hạn mức, trạng thái lượt đăng, quyền truy cập kênh).
export type FreshnessClass = 'catalog' | 'entity' | 'counter' | 'volatile' | 'session';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const FRESHNESS: Record<FreshnessClass, { staleTime: number; gcTime: number }> = {
  catalog: { staleTime: HOUR, gcTime: 24 * HOUR },
  entity: { staleTime: 30 * SECOND, gcTime: 5 * MINUTE },
  counter: { staleTime: 15 * SECOND, gcTime: 5 * MINUTE },
  volatile: { staleTime: 0, gcTime: 0 },
  session: { staleTime: 0, gcTime: 0 },
};

/** Đọc lỗi mạng/5xx thử lại đúng 1 lần (giãn 1 giây); 4xx không thử lại. */
export function shouldRetryRead(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (!(error instanceof AppError)) return false;
  return error.kind === 'network' || error.kind === 'server';
}

/** Tạo QueryClient MỚI cho mỗi phiên đăng nhập – không dùng chung giữa các tài khoản. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        refetchInterval: false,
        retry: shouldRetryRead,
        retryDelay: SECOND,
        staleTime: FRESHNESS.entity.staleTime,
        gcTime: FRESHNESS.entity.gcTime,
      },
      mutations: { retry: 0 },
    },
  });
}

/** Bắt buộc gọi trước thao tác quan trọng dựa trên dữ liệu `volatile` (vd bấm "Tạo bài bằng AI" kiểm `usage` mới). */
export function ensureFresh<T>(
  client: QueryClient,
  key: QueryKey,
  fn: () => Promise<T>,
): Promise<T> {
  return client.query({ queryKey: key, queryFn: fn, staleTime: 0 });
}
