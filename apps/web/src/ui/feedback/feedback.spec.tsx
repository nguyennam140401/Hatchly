import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';
import { emptyStateCatalog, skeletonCatalog } from './feedback.catalog';

describe('feedback', () => {
  it('catalog không vi phạm trợ năng', async () => {
    for (const entry of [skeletonCatalog, emptyStateCatalog]) {
      for (const v of entry.variants) {
        const { container, unmount } = render(<main>{v.render()}</main>);
        expect(await axe(container), `${entry.name}/${v.label}`).toHaveNoViolations();
        unmount();
      }
    }
  });
  it('Skeleton: aria-busy và thông báo "Đang tải"', () => {
    render(<Skeleton />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Đang tải')).toBeInTheDocument();
  });
  it('EmptyState: lời nhắn và hành động', () => {
    render(<EmptyState message="Chưa có gì" action={<button type="button">Tạo</button>} />);
    expect(screen.getByText('Chưa có gì')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tạo' })).toBeInTheDocument();
  });
});
