import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { AppError } from './errors';
import { FRESHNESS, type FreshnessClass } from './query-client';
import type { QueryKey } from './query-keys';

// Hai cửa duy nhất tới dữ liệu máy chủ (FR-022). Màn hình KHÔNG nhập `@tanstack/react-query` (lint).

export type ApiQueryResult<T> = UseQueryResult<T, AppError>;
export type ApiMutationResult<V, R> = UseMutationResult<R, AppError, V>;

export interface QueryOptions {
  freshness: FreshnessClass;
  enabled?: boolean;
}

export function useApiQuery<T>(
  key: QueryKey,
  fn: (ctx: { signal: AbortSignal }) => Promise<T>,
  options: QueryOptions,
): ApiQueryResult<T> {
  const { staleTime, gcTime } = FRESHNESS[options.freshness];
  return useQuery<T, AppError>({
    queryKey: key,
    // `signal` chỉ được đọc khi `fn` cần: đọc nó đánh dấu "hủy được" và react-query sẽ hủy lời gọi khi rời màn.
    // Mặc định KHÔNG hủy để phản hồi đến muộn vẫn cập nhật dữ liệu dùng chung (FR-023).
    queryFn: (context) =>
      fn({
        get signal() {
          return context.signal;
        },
      }),
    staleTime,
    gcTime,
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
  });
}

/** Thao tác được phép cập nhật lạc quan (FR-025): rẻ, dễ hoàn tác. Thao tác đắt/không đảo ngược KHÔNG nằm đây. */
export const OPTIMISTIC_ALLOWED = ['reschedule', 'markRead', 'reorder'] as const;
export type OptimisticOperation = (typeof OPTIMISTIC_ALLOWED)[number];

export interface Optimistic<V> {
  /** Áp dụng thay đổi tạm vào cache; trả về ảnh chụp để hoàn tác. */
  apply: (client: QueryClient, vars: V) => unknown;
  rollback: (client: QueryClient, vars: V, snapshot: unknown) => void;
}

export interface MutationOptions<V, R, Op extends string> {
  /** Tên thao tác – dùng để chặn `optimistic` ngoài tập cho phép ngay lúc biên dịch. */
  operation: Op;
  fn: (vars: V) => Promise<R>;
  /** Khóa cần làm mới sau khi máy chủ xác nhận (ma trận vô hiệu hóa, `mutations.ts`). */
  invalidates: (vars: V, result: R) => QueryKey[];
  optimistic?: Op extends OptimisticOperation ? Optimistic<V> : never;
}

export function useApiMutation<V, R, Op extends string>(
  options: MutationOptions<V, R, Op>,
): ApiMutationResult<V, R> {
  const client = useQueryClient();
  const optimistic = options.optimistic as Optimistic<V> | undefined;
  return useMutation<R, AppError, V>({
    mutationFn: options.fn,
    ...(optimistic !== undefined
      ? { onMutate: (vars: V) => optimistic.apply(client, vars) }
      : {}),
    onError: (_error, vars, snapshot) => {
      if (optimistic !== undefined) optimistic.rollback(client, vars, snapshot);
    },
    onSuccess: async (result, vars) => {
      await Promise.all(
        options.invalidates(vars, result).map((queryKey) => client.invalidateQueries({ queryKey })),
      );
    },
  });
}

/** Làm mới mọi dữ liệu đang hiển thị (nút "Thử lại" của biểu ngữ mất mạng). */
export function useRefreshAll(): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries();
  };
}
