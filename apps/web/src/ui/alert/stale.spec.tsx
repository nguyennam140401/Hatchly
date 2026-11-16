import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { StaleNotice } from './StaleNotice';

describe('StaleNotice', () => {
  it('cảnh báo "Bài viết đã được thay đổi" + "Xem bản mới"; không vi phạm trợ năng', async () => {
    const onViewLatest = vi.fn();
    const { container } = render(
      <main>
        <StaleNotice onViewLatest={onViewLatest}>Người khác vừa sửa bài này.</StaleNotice>
      </main>,
    );
    expect(screen.getByText('Bài viết đã được thay đổi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem bản mới' }));
    expect(onViewLatest).toHaveBeenCalledTimes(1);
    expect(await axe(container)).toHaveNoViolations();
  });
});
