import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/helpers/render';
import { axe } from '../../../test/helpers/axe';
import { ErrorNotice } from './ErrorNotice';
import { AppError } from './errors';

function err(init: Partial<ConstructorParameters<typeof AppError>[0]> = {}) {
  return new AppError({
    kind: 'server',
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'Hệ thống đang bận.',
    support: { traceId: 'trace-123' },
    ...init,
  });
}

describe('ErrorNotice (SC-010)', () => {
  it('luôn có ≥ 1 nút hành động, kể cả khi máy chủ không trả hành động', () => {
    renderWithProviders(
      <ErrorNotice error={err({ kind: 'forbidden', status: 403, code: 'FORBIDDEN' })} />,
    );
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(1);
  });

  it('lỗi máy chủ có onRetry → có nút "Thử lại" và bấm gọi onRetry', () => {
    const onRetry = vi.fn();
    renderWithProviders(<ErrorNotice error={err()} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('mã gốc và mã theo dõi chỉ nằm trong "Chi tiết cho hỗ trợ" (thu gọn)', () => {
    const { container } = renderWithProviders(<ErrorNotice error={err()} />);
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details?.textContent).toContain('SERVICE_UNAVAILABLE');
    expect(details?.textContent).toContain('trace-123');
    const outside = container.textContent.replace(details?.textContent ?? '', '');
    expect(outside).not.toContain('SERVICE_UNAVAILABLE');
    expect(outside).not.toContain('trace-123');
  });

  it('không vi phạm trợ năng', async () => {
    const { container } = renderWithProviders(
      <main>
        <ErrorNotice error={err()} onRetry={() => undefined} />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
