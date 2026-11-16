import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AVAILABLE_ICON_FILES, ICON_NAMES, Icon } from './Icon';

describe('Icon', () => {
  it('đủ 26 tên, mỗi tên có tệp SVG hợp lệ', () => {
    expect(ICON_NAMES).toHaveLength(26);
    expect([...AVAILABLE_ICON_FILES].sort()).toEqual([...ICON_NAMES].sort());
  });
  it('mỗi biểu tượng render ra <svg>', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg'), name).not.toBeNull();
      unmount();
    }
  });
  it('trang trí: aria-hidden; có title: role=img + nhãn', () => {
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    render(<Icon name="alert" title="Cảnh báo" />);
    expect(screen.getByRole('img', { name: 'Cảnh báo' })).toBeInTheDocument();
  });
});
