import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartPage } from '../src/app/StartPage';

const healthy = {
  status: 'ok',
  unit: 'api',
  version: '0.0.0-dev',
  time: '2026-11-08T03:00:00.000Z',
};

function mockFetchOnce(impl: () => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StartPage', () => {
  it('API trả /healthz hợp lệ → "API đang hoạt động" kèm ✓ có nhãn', async () => {
    mockFetchOnce(() => json(healthy));
    render(<StartPage />);
    expect(await screen.findByText('API đang hoạt động')).toBeInTheDocument();
    const icon = screen.getByRole('img', { name: 'Thành công' });
    expect(icon).toHaveTextContent('✓');
  });

  it('lỗi mạng → "Không kết nối được API" kèm ⚠ và nút Thử lại; bấm thì gọi lại', async () => {
    const fetchMock = mockFetchOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<StartPage />);
    expect(await screen.findByText('Không kết nối được API')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cảnh báo' })).toHaveTextContent('⚠');

    const retry = screen.getByRole('button', { name: 'Thử lại' });
    expect(retry).toHaveStyle({ minWidth: '44px', minHeight: '44px' });

    fetchMock.mockImplementation(() => json(healthy));
    fireEvent.click(retry);
    expect(await screen.findByText('API đang hoạt động')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('phản hồi sai lược đồ → coi như không kết nối được', async () => {
    mockFetchOnce(() => json({ status: 'ok', unitName: 'api' }));
    render(<StartPage />);
    expect(await screen.findByText('Không kết nối được API')).toBeInTheDocument();
  });

  it('API trả ErrorResponse → hiện lời giải thích của máy chủ', async () => {
    mockFetchOnce(() =>
      json(
        {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Hệ thống đang tạm dừng để cập nhật. Vui lòng thử lại sau ít phút.',
            actions: [{ kind: 'retry', label: 'Thử lại' }],
            support: { traceId: 'abc' },
          },
        },
        503,
      ),
    );
    render(<StartPage />);
    expect(await screen.findByText('Không kết nối được API')).toBeInTheDocument();
    expect(
      screen.getByText('Hệ thống đang tạm dừng để cập nhật. Vui lòng thử lại sau ít phút.'),
    ).toBeInTheDocument();
  });
});
