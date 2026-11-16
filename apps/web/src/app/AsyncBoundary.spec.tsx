import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/helpers/render';
import {
  SAMPLE_ITEMS,
  fetchScenario,
  respondTo,
  type SampleResponse,
  type Scenario,
} from '../catalog/fixtures/scenarios';
import { useApiQuery, type ApiQueryResult } from '../lib/api/hooks';
import { createQueryClient } from '../lib/api/query-client';
import { AsyncBoundary } from './AsyncBoundary';

// Lấy kết quả `useApiQuery` thật cho từng tình huống rồi đưa vào AsyncBoundary.
async function queryFor(scenario: Scenario): Promise<ApiQueryResult<SampleResponse>> {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } }); // lỗi 5xx mặc định được thử lại; spec cần kết quả lỗi ngay
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () =>
      useApiQuery(['sample', scenario], () => fetchScenario(scenario), { freshness: 'volatile' }),
    { wrapper },
  );
  if (scenario !== 'loading') {
    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
  }
  return result.current;
}

function show(query: ApiQueryResult<SampleResponse>, scenario: Scenario) {
  const data = respondTo(scenario);
  return renderWithProviders(
    <AsyncBoundary
      query={query}
      isEmpty={(d) => d.items.length === 0}
      empty={{ message: 'Chưa có bài nào', action: <button type="button">Tạo bài</button> }}
      {...(data.locked !== undefined
        ? {
            lockedBy: {
              locked: true,
              reason: data.locked.reason,
              reopensAt: new Date(data.locked.reopensAt),
            },
          }
        : {})}
      partial={(d) =>
        d.partial !== undefined
          ? {
              done: `Đã đăng: ${String(d.partial.done)}`,
              attention: `Cần bạn xử lý: ${String(d.partial.attention)}`,
            }
          : null
      }
    >
      {(d) => (
        <ul>
          {d.items.map((i) => (
            <li key={i.id}>{i.title}</li>
          ))}
        </ul>
      )}
    </AsyncBoundary>,
  );
}

describe('AsyncBoundary – 5 tình huống', () => {
  it('loading: khung chờ + "Đang tải"', async () => {
    show(await queryFor('loading'), 'loading');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Đang tải')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('empty: lời nhắn + một hành động', async () => {
    show(await queryFor('empty'), 'empty');
    expect(screen.getByText('Chưa có bài nào')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tạo bài' })).toBeInTheDocument();
  });

  it('error: ErrorNotice + "Thử lại"; mã gốc chỉ trong chi tiết hỗ trợ', async () => {
    const { container } = show(await queryFor('error'), 'error');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(container.querySelector('details')?.textContent).toContain('SERVICE_UNAVAILABLE');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('locked: giải thích + ngày mở lại (UTC+7), không hiện nội dung', async () => {
    show(await queryFor('locked'), 'locked');
    expect(screen.getByText(/Tính năng này đang tạm khóa/)).toBeInTheDocument();
    expect(screen.getByText(/Đã dùng hết lượt AI/)).toBeInTheDocument();
    expect(screen.getByText(/Mở lại vào 01\/12\/2026/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('partial: dòng tóm tắt "Đã đăng … · Cần bạn xử lý …" cùng nội dung', async () => {
    show(await queryFor('partial'), 'partial');
    expect(screen.getByText('Đã đăng: 2 · Cần bạn xử lý: 1')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(SAMPLE_ITEMS.length);
  });

  it('ok: chỉ nội dung, không có cảnh báo', async () => {
    show(await queryFor('ok'), 'ok');
    expect(screen.getAllByRole('listitem')).toHaveLength(SAMPLE_ITEMS.length);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
