import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/query-client';
import { queryKeys } from '../api/query-keys';
import { JOB_POLL_MAX_MS, JOB_POLL_MS, useJobProgress, type JobProgress } from './useJobProgress';

const job = (state: JobProgress['state'], done = 1): JobProgress => ({
  jobId: 'j1',
  kind: 'bulk-create',
  done,
  total: 10,
  state,
});

function setup(fetch: () => Promise<JobProgress>, extra: Parameters<typeof useJobProgress>[1] extends infer T ? Partial<T> : never = {}) {
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useJobProgress('j1', { fetch, ...extra }), { wrapper });
  return { client, ...hook };
}

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useJobProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('làm mới mỗi 3 giây khi còn running; dừng khi xong và vô hiệu hóa theo thao tác tạo việc', async () => {
    const fetch = vi
      .fn<() => Promise<JobProgress>>()
      .mockResolvedValueOnce(job('running', 1))
      .mockResolvedValueOnce(job('running', 5))
      .mockResolvedValue(job('succeeded', 10));
    const onFinished = vi.fn();
    const { client } = setup(fetch, { invalidateOnFinish: [queryKeys.posts.lists()], onFinished });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1); });
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_POLL_MS); });
    await waitFor(() => { expect(fetch).toHaveBeenCalledTimes(2); });
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_POLL_MS); });
    await waitFor(() => { expect(onFinished).toHaveBeenCalledTimes(1); });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.posts.lists() });
    const calls = fetch.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_POLL_MS * 3); });
    expect(fetch.mock.calls.length).toBe(calls); // xong → không làm mới nữa
  });

  it('tab ẩn → không làm mới', async () => {
    const fetch = vi.fn<() => Promise<JobProgress>>().mockResolvedValue(job('running'));
    setup(fetch);
    await waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1); });
    setVisibility('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_POLL_MS * 4); });
    expect(fetch).toHaveBeenCalledTimes(1);
    setVisibility('visible'); // quay lại tab → làm mới ngay
    await waitFor(() => { expect(fetch.mock.calls.length).toBeGreaterThan(1); });
  });

  it('gỡ gắn thành phần → ngừng làm mới', async () => {
    const fetch = vi.fn<() => Promise<JobProgress>>().mockResolvedValue(job('running'));
    const { unmount } = setup(fetch);
    await waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1); });
    unmount();
    const calls = fetch.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_POLL_MS * 4); });
    expect(fetch.mock.calls.length).toBe(calls);
  });

  it('dừng sau 5 phút', async () => {
    const fetch = vi.fn<() => Promise<JobProgress>>().mockResolvedValue(job('running'));
    setup(fetch);
    await waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1); });
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_POLL_MAX_MS + JOB_POLL_MS); });
    const calls = fetch.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_POLL_MS * 5); });
    expect(fetch.mock.calls.length).toBe(calls);
  });
});
