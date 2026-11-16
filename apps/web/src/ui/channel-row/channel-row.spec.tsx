import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { PageHeader } from '../layout/PageHeader';
import { ChannelRow } from './ChannelRow';
import { channelRowCatalog, pageHeaderCatalog } from './channel-row.catalog';

describe('ChannelRow / PageHeader', () => {
  it('catalog không vi phạm trợ năng', async () => {
    for (const entry of [channelRowCatalog, pageHeaderCatalog]) {
      for (const v of entry.variants) {
        const { container, unmount } = render(<main>{v.render()}</main>);
        expect(await axe(container), `${entry.name}/${v.label}`).toHaveNoViolations();
        unmount();
      }
    }
  });
  it('mỗi trạng thái kênh có chữ + biểu tượng', () => {
    for (const [state, text] of [
      ['connected', 'Đã kết nối'],
      ['expiring', 'Sắp hết hạn'],
      ['disconnected', 'Chưa kết nối'],
      ['manual', 'Đăng tay'],
    ] as const) {
      const { container, unmount } = render(<ChannelRow channel="facebook" state={state} />);
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(container.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });
  it('PageHeader có h1', () => {
    render(<PageHeader title="Bài viết" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Bài viết' })).toBeInTheDocument();
  });
});
