import { describe, expect, it, vi } from 'vitest';
import { AppError } from './errors';
import { createQueryClient, ensureFresh, FRESHNESS, shouldRetryRead } from './query-client';

const err = (kind: AppError['kind']) =>
  new AppError({ kind, status: 0, code: 'X', message: 'm', actions: [] });

describe('FRESHNESS', () => {
  it('đúng số liệu từng lớp', () => {
    expect(FRESHNESS.catalog).toEqual({ staleTime: 3_600_000, gcTime: 86_400_000 });
    expect(FRESHNESS.entity).toEqual({ staleTime: 30_000, gcTime: 300_000 });
    expect(FRESHNESS.counter).toEqual({ staleTime: 15_000, gcTime: 300_000 });
    expect(FRESHNESS.volatile).toEqual({ staleTime: 0, gcTime: 0 });
    expect(FRESHNESS.session).toEqual({ staleTime: 0, gcTime: 0 });
  });
});

describe('createQueryClient', () => {
  it('mặc định: làm mới khi lấy tiêu điểm/mount, không làm mới định kỳ, ghi không thử lại', () => {
    const q = createQueryClient().getDefaultOptions();
    expect(q.queries?.refetchOnWindowFocus).toBe(true);
    expect(q.queries?.refetchOnMount).toBe(true);
    expect(q.queries?.refetchInterval).toBe(false);
    expect(q.mutations?.retry).toBe(0);
  });
  it('mỗi lần tạo là một client riêng', () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});

describe('shouldRetryRead', () => {
  it('thử lại 1 lần cho mạng/5xx; không cho 4xx hay lỗi lạ', () => {
    expect(shouldRetryRead(0, err('network'))).toBe(true);
    expect(shouldRetryRead(0, err('server'))).toBe(true);
    expect(shouldRetryRead(1, err('network'))).toBe(false);
    expect(shouldRetryRead(0, err('forbidden'))).toBe(false);
    expect(shouldRetryRead(0, err('validation'))).toBe(false);
    expect(shouldRetryRead(0, new Error('x'))).toBe(false);
  });
});

describe('ensureFresh', () => {
  it('luôn gọi lại máy chủ dù dữ liệu còn mới', async () => {
    const client = createQueryClient();
    const fn = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect(await ensureFresh(client, ['k'], fn)).toBe(1);
    expect(await ensureFresh(client, ['k'], fn)).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
