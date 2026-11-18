// Thanh dung lượng (014 FR-010, contracts/media-ui.md mục 3): ok / sắp đầy (≥ 80%) / đầy bằng CHỮ + biểu tượng, không số tiền.
import { cleanup, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it } from 'vitest';
import { QuotaMeter } from '../../src/features/media/QuotaMeter';
import { quota } from './helpers';

afterEach(cleanup);

describe('QuotaMeter', () => {
  it('bình thường: "Đã dùng 1,2 GB / 5 GB", không cảnh báo', async () => {
    const { container } = render(<QuotaMeter quota={quota(1.2)} />);
    expect(screen.getByText('Đã dùng 1,2 GB / 5 GB')).toBeInTheDocument();
    expect(screen.queryByText('Sắp đầy')).toBeNull();
    expect(screen.queryByText('Đầy')).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '24');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('≥ 80% ⇒ "Sắp đầy" kèm biểu tượng cảnh báo (không chỉ màu)', async () => {
    const { container } = render(<QuotaMeter quota={quota(4.2)} />);
    const warn = screen.getByText('Sắp đầy');
    expect(warn.parentElement?.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '84');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('giữ chỗ cũng được tính vào "đã dùng"; đạt trần ⇒ "Đầy"', async () => {
    const { container } = render(<QuotaMeter quota={quota(4.5, 0.5)} />);
    expect(screen.getByText('Đã dùng 5 GB / 5 GB')).toBeInTheDocument();
    expect(screen.getByText('Đầy')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('chỉ nói về dung lượng – không có số tiền nào (hiến pháp III)', () => {
    const { container } = render(<QuotaMeter quota={quota(4.9)} />);
    expect(container.textContent).not.toMatch(/USD|\$|₫|VND|micro/i);
  });
});
