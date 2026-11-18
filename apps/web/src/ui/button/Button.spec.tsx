import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { Button } from './Button';
import { buttonCatalog } from './Button.catalog';

describe('Button', () => {
  it('render mọi biến thể (8 tổ hợp + loading) không vi phạm trợ năng', async () => {
    for (const variant of buttonCatalog.variants) {
      const { container, unmount } = render(<main>{variant.render()}</main>);
      expect(await axe(container), variant.label).toHaveNoViolations();
      unmount();
    }
  });

  it('bấm gọi onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Lưu</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('khóa: aria-disabled, vẫn focus được, không gọi onClick, có lý do liên kết', () => {
    const onClick = vi.fn();
    render(
      <Button locked lockedReason="Hết lượt AI" onClick={onClick}>
        Tạo
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Tạo' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toBeDisabled();
    btn.focus();
    expect(btn).toHaveFocus();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    expect(btn).toHaveAccessibleDescription('Hết lượt AI');
  });

  it('khóa kèm ngày mở lại', () => {
    render(
      <Button locked lockedReason="Hết lượt." reopensAt={new Date('2026-12-01T00:00:00Z')}>
        Tạo
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Tạo' })).toHaveAccessibleDescription(
      'Hết lượt. Mở lại vào 01/12/2026',
    );
  });

  it('loading: "Đang lưu…", aria-busy, không nhận bấm thêm', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Lưu
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Đang lưu…' });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
