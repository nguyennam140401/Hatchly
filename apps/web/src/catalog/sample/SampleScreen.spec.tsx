import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { SampleScreen } from './SampleScreen';

function show() {
  const router = createMemoryRouter([{ path: '/', element: <SampleScreen /> }]);
  return render(<RouterProvider router={router} />);
}

describe('SampleScreen', () => {
  it('hiện danh sách thẻ bài và biểu mẫu', async () => {
    show();
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(3);
    });
    expect(screen.getByRole('button', { name: 'Lưu ý tưởng' })).toBeInTheDocument();
  });

  it('chuyển tình huống "Trống" → lời nhắn + hành động', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Trống' }));
    await waitFor(() => {
      expect(screen.getByText(/Chưa có bài nào/)).toBeInTheDocument();
    });
  });

  it('chuyển tình huống "Bị khóa" → giải thích + ngày mở lại', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Bị khóa' }));
    await waitFor(() => {
      expect(screen.getByText(/Mở lại vào 01\/12\/2026/)).toBeInTheDocument();
    });
  });

  it('không vi phạm trợ năng', async () => {
    const { container } = show();
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(3);
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
