import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { POST_DISPLAY_STATUSES, POST_STATUS_META } from '../../lib/catalogs/post-status';
import { StatusBadge } from './StatusBadge';
import { SuggestionTag } from './SuggestionTag';
import { statusBadgeCatalog, suggestionTagCatalog } from './badge.catalog';

describe('StatusBadge', () => {
  it('mọi trạng thái luôn có chữ VÀ biểu tượng', () => {
    for (const status of POST_DISPLAY_STATUSES) {
      const { container, unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(POST_STATUS_META[status].label)).toBeInTheDocument();
      expect(container.querySelector('svg'), status).not.toBeNull();
      unmount();
    }
  });
  it('trạng thái lạ → "Đang cập nhật", không ném lỗi', () => {
    render(<StatusBadge status="không-biết" />);
    expect(screen.getByText('Đang cập nhật')).toBeInTheDocument();
  });
  it('catalog không vi phạm trợ năng', async () => {
    for (const entry of [statusBadgeCatalog, suggestionTagCatalog]) {
      for (const v of entry.variants) {
        const { container, unmount } = render(<main>{v.render()}</main>);
        expect(await axe(container), `${entry.name}/${v.label}`).toHaveNoViolations();
        unmount();
      }
    }
  });
});

describe('SuggestionTag', () => {
  it('hiện "Gợi ý hôm nay" kèm biểu tượng', () => {
    const { container } = render(<SuggestionTag />);
    expect(screen.getByText('Gợi ý hôm nay')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
