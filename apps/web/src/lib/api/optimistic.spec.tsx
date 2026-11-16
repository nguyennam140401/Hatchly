import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { useApiMutation } from './hooks';
import { useDestructiveAction } from './useDestructiveAction';
import { createQueryClient } from './query-client';

const fail = () =>
  new AppError({
    kind: 'business',
    status: 409,
    code: 'SEATS_FULL',
    message: 'Máy chủ từ chối',
    actions: [{ kind: 'retry', label: 'Thử lại' }],
  });

function Providers({
  client,
  children,
}: {
  client: ReturnType<typeof createQueryClient>;
  children: ReactNode;
}) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('cập nhật lạc quan an toàn', () => {
  it('reschedule: hiện ngay, máy chủ từ chối → hoàn lại', async () => {
    const client = createQueryClient();
    client.setQueryData(['slot'], '09:00');
    function Probe() {
      const m = useApiMutation({
        operation: 'reschedule',
        fn: () => Promise.reject(fail()),
        invalidates: () => [],
        optimistic: {
          apply: (c, to) => {
            const prev = c.getQueryData(['slot']);
            c.setQueryData(['slot'], to);
            return prev;
          },
          rollback: (c, _to, prev) => {
            c.setQueryData(['slot'], prev);
          },
        },
      });
      return (
        <button
          type="button"
          onClick={() => {
            m.mutate('10:00');
          }}
        >
          đổi
        </button>
      );
    }
    render(
      <Providers client={client}>
        <Probe />
      </Providers>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'đổi' }));
    expect(client.getQueryData(['slot'])).toBe('10:00'); // hiện ngay
    await waitFor(() => {
      expect(client.getQueryData(['slot'])).toBe('09:00'); // hoàn lại sau khi bị từ chối
    });
  });

  it('markRead: giữ kết quả khi máy chủ xác nhận', async () => {
    const client = createQueryClient();
    client.setQueryData(['unread'], 3);
    function Probe() {
      const m = useApiMutation({
        operation: 'markRead',
        fn: () => Promise.resolve('ok'),
        invalidates: () => [],
        optimistic: {
          apply: (c) => {
            c.setQueryData(['unread'], 2);
            return 3;
          },
          rollback: (c, _v, prev) => {
            c.setQueryData(['unread'], prev);
          },
        },
      });
      return (
        <button
          type="button"
          onClick={() => {
            m.mutate('n1');
          }}
        >
          đọc
        </button>
      );
    }
    render(
      <Providers client={client}>
        <Probe />
      </Providers>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'đọc' }));
    await waitFor(() => {
      expect(client.getQueryData(['unread'])).toBe(2);
    });
  });
});

describe('thao tác destructive (xóa/ngắt kết nối/hủy lịch)', () => {
  function Probe({ run }: { run: () => Promise<string> }) {
    const mutation = useApiMutation({
      operation: 'deleteMedia',
      fn: () => run(),
      invalidates: () => [],
    });
    const { ask, dialog } = useDestructiveAction({
      mutation,
      title: 'Xóa ảnh này?',
      body: 'Ảnh sẽ mất khỏi thư viện.',
      confirmLabel: 'Xóa',
    });
    return (
      <>
        <button
          type="button"
          onClick={() => {
            ask('m1');
          }}
        >
          mở
        </button>
        {dialog}
      </>
    );
  }

  it('hỏi xác nhận TRƯỚC: chưa xác nhận thì không gọi máy chủ', async () => {
    let calls = 0;
    render(
      <Providers client={createQueryClient()}>
        <Probe
          run={() => {
            calls += 1;
            return Promise.resolve('ok');
          }}
        />
      </Providers>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'mở' }));
    expect(await screen.findByRole('dialog', { name: 'Xóa ảnh này?' })).toBeInTheDocument();
    expect(calls).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls).toBe(1);
  });

  it('chờ máy chủ xác nhận; từ chối → hộp còn mở, có lỗi + hành động', async () => {
    render(
      <Providers client={createQueryClient()}>
        <Probe run={() => Promise.reject(fail())} />
      </Providers>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'mở' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa' }));
    expect(await screen.findByText('Máy chủ từ chối')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Xóa ảnh này?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });
});
