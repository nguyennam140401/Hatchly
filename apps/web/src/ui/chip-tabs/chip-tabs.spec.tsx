import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { ChannelTabs } from './ChannelTabs';
import { Chip } from './Chip';
import { channelTabsCatalog, chipCatalog } from './chip-tabs.catalog';

describe('chip & tabs', () => {
  it('catalog không vi phạm trợ năng', async () => {
    for (const entry of [chipCatalog, channelTabsCatalog]) {
      for (const v of entry.variants) {
        const { container, unmount } = render(<main>{v.render()}</main>);
        expect(await axe(container), `${entry.name}/${v.label}`).toHaveNoViolations();
        unmount();
      }
    }
  });
});

describe('Chip', () => {
  it('aria-pressed theo selected; bấm gọi onClick; nút bỏ có nhãn', () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(<Chip label="A" selected onClick={onClick} onRemove={onRemove} />);
    const chip = screen.getByRole('button', { name: 'A' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ: A' }));
    expect(onClick).toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('ChannelTabs', () => {
  const channels = [
    { id: 'facebook', label: 'Facebook' },
    { id: 'tiktok', label: 'TikTok' },
    { id: 'zalo', label: 'Zalo' },
  ];
  it('mũi tên phải chuyển sang tab kế', async () => {
    const onChange = vi.fn();
    render(<ChannelTabs channels={channels} value="facebook" onChange={onChange} />);
    const first = screen.getByRole('tab', { name: 'Facebook' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('tiktok');
    });
  });
  it('tab đang chọn có aria-selected', () => {
    render(<ChannelTabs channels={channels} value="tiktok" onChange={() => undefined} />);
    expect(screen.getByRole('tab', { name: 'TikTok' })).toHaveAttribute('aria-selected', 'true');
  });
});
