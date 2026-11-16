import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useApiMutation, useApiQuery } from './hooks';
import { createQueryClient } from './query-client';
import { queryKeys } from './query-keys';

function setup() {
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('useApiQuery', () => {
  it('đọc dữ liệu qua hàm được truyền và áp lớp làm mới', async () => {
    const { client, wrapper } = setup();
    const fn = vi.fn().mockResolvedValue({ n: 1 });
    const { result } = renderHook(
      () => useApiQuery(queryKeys.usage.current(), fn, { freshness: 'volatile' }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.data).toEqual({ n: 1 });
    });
    expect(client.getQueryCache().find({ queryKey: queryKeys.usage.current() })?.isStale()).toBe(
      true,
    );
  });
});

describe('useApiMutation', () => {
  it('thành công → làm mới đúng các khóa khai báo', async () => {
    const { client, wrapper } = setup();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(
      () =>
        useApiMutation({
          operation: 'approve',
          fn: (id: string) => Promise.resolve(id),
          invalidates: (id) => [queryKeys.posts.detail(id), queryKeys.posts.lists()],
        }),
      { wrapper },
    );
    await act(() => result.current.mutateAsync('p1'));
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.posts.detail('p1') });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.posts.lists() });
  });

  it('cập nhật lạc quan cho thao tác được phép; máy chủ từ chối → hoàn lại', async () => {
    const { client, wrapper } = setup();
    client.setQueryData(['n'], 1);
    const { result } = renderHook(
      () =>
        useApiMutation({
          operation: 'markRead',
          fn: () => Promise.reject(new Error('từ chối')),
          invalidates: () => [],
          optimistic: {
            apply: (c) => {
              const prev = c.getQueryData(['n']);
              c.setQueryData(['n'], 0);
              return prev;
            },
            rollback: (c, _v, prev) => c.setQueryData(['n'], prev),
          },
        }),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync('x').catch(() => undefined);
    });
    expect(client.getQueryData(['n'])).toBe(1);
  });

  it('chặn tại biên dịch: thao tác đắt không được `optimistic`', () => {
    // Kiểm tra bằng kiểu: dòng dưới phải lỗi biên dịch; chạy thật chỉ để tham chiếu hàm.
    const useBuild = () =>
      useApiMutation({
        operation: 'approve',
        fn: () => Promise.resolve(1),
        invalidates: () => [],
        // @ts-expect-error `approve` không nằm trong OPTIMISTIC_ALLOWED
        optimistic: { apply: () => undefined, rollback: () => undefined },
      });
    expect(typeof useBuild).toBe('function');
  });
});
