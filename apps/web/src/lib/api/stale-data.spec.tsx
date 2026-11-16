import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw-server';
import { OfflineBanner } from '../../app/shell/OfflineBanner';
import { apiClient } from './client';
import { setApiReachable } from './connectivity';
import { AppError } from './errors';
import { useApiQuery } from './hooks';
import { createQueryClient } from './query-client';
import { queryKeys } from './query-keys';

const Value = {
  safeParse: (v: unknown) =>
    typeof v === 'object' && v !== null && 'v' in v
      ? { success: true as const, data: (v as { v: string }).v }
      : { success: false as const },
};

function Providers({
  client,
  children,
}: {
  client: ReturnType<typeof createQueryClient>;
  children: ReactNode;
}) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function Screen({ freshness }: { freshness: 'entity' | 'volatile' }) {
  const q = useApiQuery(
    queryKeys.posts.detail('p1'),
    () => apiClient.request('GET', 'http://localhost/api/thing', { schema: Value }),
    { freshness },
  );
  return <p>{q.data ?? (q.isError ? 'lỗi' : 'đang tải')}</p>;
}

afterEach(() => {
  setApiReachable(true);
});

describe('dữ liệu cũ / mới (FR-023, FR-024)', () => {
  it('lớp volatile không giữ cache: rời màn là bộ nhớ sạch (gcTime 0)', async () => {
    let n = 0;
    server.use(
      http.get('http://localhost/api/thing', () => HttpResponse.json({ v: `lần ${String(++n)}` })),
    );
    const client = createQueryClient();
    const { unmount } = render(
      <Providers client={client}>
        <Screen freshness="volatile" />
      </Providers>,
    );
    expect(await screen.findByText('lần 1')).toBeInTheDocument();
    unmount();
    await waitFor(() => {
      expect(
        client.getQueryCache().find({ queryKey: queryKeys.posts.detail('p1') }),
      ).toBeUndefined();
    });
  });

  it('quay lại màn: hiện dữ liệu cũ TỨC THÌ rồi cập nhật khi đã cũ', async () => {
    let n = 0;
    server.use(
      http.get('http://localhost/api/thing', () => HttpResponse.json({ v: `bản ${String(++n)}` })),
    );
    const client = createQueryClient();
    const first = render(
      <Providers client={client}>
        <Screen freshness="entity" />
      </Providers>,
    );
    expect(await screen.findByText('bản 1')).toBeInTheDocument();
    first.unmount();
    await client.invalidateQueries({ queryKey: queryKeys.posts.detail('p1'), refetchType: 'none' }); // đánh dấu cũ
    render(
      <Providers client={client}>
        <Screen freshness="entity" />
      </Providers>,
    );
    expect(screen.getByText('bản 1')).toBeInTheDocument(); // tức thì, không "đang tải"
    expect(await screen.findByText('bản 2')).toBeInTheDocument(); // rồi cập nhật
  });

  it('mất mạng: vẫn xem dữ liệu đã tải; biểu ngữ "Dữ liệu có thể chưa mới" + "Thử lại"', async () => {
    server.use(http.get('http://localhost/api/thing', () => HttpResponse.json({ v: 'đã tải' })));
    const client = createQueryClient();
    render(
      <Providers client={client}>
        <OfflineBanner onRetry={() => undefined} />
        <Screen freshness="entity" />
      </Providers>,
    );
    expect(await screen.findByText('đã tải')).toBeInTheDocument();
    expect(screen.queryByText('Dữ liệu có thể chưa mới')).toBeNull();

    server.use(http.get('http://localhost/api/thing', () => HttpResponse.error()));
    await act(async () => {
      await client.refetchQueries({ queryKey: queryKeys.posts.detail('p1') });
    });
    expect(await screen.findByText('Dữ liệu có thể chưa mới')).toBeInTheDocument();
    expect(screen.getByText('đã tải')).toBeInTheDocument(); // dữ liệu cũ còn nguyên
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });

  it('mất mạng khi ghi: lỗi network có hành động "Thử lại", dữ liệu nhập không mất', async () => {
    server.use(http.post('http://localhost/api/save', () => HttpResponse.error()));
    function Writer() {
      const [text, setText] = useStateText();
      const [error, setError] = useStateError();
      return (
        <>
          <input
            aria-label="Nội dung"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <button
            type="button"
            onClick={() => {
              apiClient
                .request('POST', 'http://localhost/api/save', { body: { text } })
                .catch((e: unknown) => {
                  if (e instanceof AppError) setError(e);
                });
            }}
          >
            Gửi
          </button>
          {error !== null && <p role="alert">{`${error.kind}: ${error.actions[0].label}`}</p>}
        </>
      );
    }
    render(<Writer />);
    fireEvent.change(screen.getByLabelText('Nội dung'), { target: { value: 'bài đang viết dở' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('network: Thử lại');
    expect(screen.getByLabelText('Nội dung')).toHaveValue('bài đang viết dở');
  });

  it('phản hồi đến sau khi rời màn: không làm đổi màn khác nhưng vẫn cập nhật dữ liệu dùng chung', async () => {
    let release: () => void = () => undefined;
    let started = false;
    server.use(
      http.get('http://localhost/api/thing', async () => {
        started = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json({ v: 'đến muộn' });
      }),
    );
    const client = createQueryClient();
    const a = render(
      <Providers client={client}>
        <Screen freshness="entity" />
      </Providers>,
    );
    expect(screen.getByText('đang tải')).toBeInTheDocument();
    await waitFor(() => {
      expect(started).toBe(true);
    });
    a.unmount(); // rời màn A khi lời gọi chưa xong
    const b = render(
      <Providers client={client}>
        <p>Màn khác</p>
      </Providers>,
    );
    release();
    await waitFor(() => {
      expect(client.getQueryData(queryKeys.posts.detail('p1'))).toBe('đến muộn');
    });
    expect(b.container).toHaveTextContent('Màn khác');
    expect(b.container).not.toHaveTextContent('đến muộn');
  });
});

import { useState } from 'react';
const useStateText = () => useState('');
const useStateError = () => useState<AppError | null>(null);
