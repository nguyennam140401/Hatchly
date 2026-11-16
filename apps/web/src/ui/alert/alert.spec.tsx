import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { ConfirmDialog } from './ConfirmDialog';
import { InlineAlert } from './InlineAlert';
import { inlineAlertCatalog } from './alert.catalog';

describe('InlineAlert', () => {
  it('catalog không vi phạm trợ năng', async () => {
    for (const v of inlineAlertCatalog.variants) {
      const { container, unmount } = render(<main>{v.render()}</main>);
      expect(await axe(container), v.label).toHaveNoViolations();
      unmount();
    }
  });

  it('lỗi dùng role=alert, thông tin dùng role=status', () => {
    const { rerender } = render(
      <InlineAlert tone="error" actions={[{ kind: 'retry', label: 'Thử lại' }]}>
        Lỗi
      </InlineAlert>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<InlineAlert tone="info">Thông tin</InlineAlert>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('tone="error" bắt buộc có hành động (kiểm tra bằng kiểu)', () => {
    // prettier-ignore
    // @ts-expect-error lỗi mà không có `actions` phải bị chặn lúc biên dịch
    const bad = <InlineAlert tone="error">Lỗi</InlineAlert>;
    // prettier-ignore
    // @ts-expect-error `actions` rỗng không được chấp nhận cho tone="error"
    const empty = <InlineAlert tone="error" actions={[]}>Lỗi</InlineAlert>;
    expect(bad).toBeDefined();
    expect(empty).toBeDefined();
  });

  it('mã gốc chỉ nằm trong "Chi tiết cho hỗ trợ"; "Gửi cho hỗ trợ" sao chép mã', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <InlineAlert
        tone="error"
        actions={[{ kind: 'retry', label: 'Thử lại' }]}
        support={{ traceId: 'T-1', code: 'X_FAILED' }}
      >
        Chưa được
      </InlineAlert>,
    );
    const details = screen.getByText('Chi tiết cho hỗ trợ').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(details).toContainElement(screen.getByText('X_FAILED'));
    fireEvent.click(screen.getByRole('button', { name: /Gửi cho hỗ trợ/ }));
    expect(writeText).toHaveBeenCalledWith('X_FAILED · T-1');
    expect(await screen.findByText('Đã sao chép mã để gửi cho hỗ trợ')).toBeInTheDocument();
  });

  it('bấm hành động gọi onAction', () => {
    const onAction = vi.fn();
    render(
      <InlineAlert tone="error" actions={[{ kind: 'retry', label: 'Thử lại' }]} onAction={onAction}>
        Lỗi
      </InlineAlert>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'retry', label: 'Thử lại' });
  });
});

describe('ConfirmDialog', () => {
  it('hiện tiêu đề; xác nhận gọi onConfirm; Esc đóng', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Xóa bài?"
        body="Không hoàn tác được."
        confirmLabel="Xóa"
        onConfirm={onConfirm}
        tone="danger"
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Xóa bài?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
