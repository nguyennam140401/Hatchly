import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { toDisplayStatus } from '../../lib/catalogs/post-status';
import { ChannelTag } from './ChannelTag';
import { IdeaCard } from './IdeaCard';
import { PostCard } from './PostCard';
import { UsageMeter } from './UsageMeter';
import {
  channelTagCatalog,
  ideaCardCatalog,
  postCardCatalog,
  usageMeterCatalog,
} from './cards.catalog';

describe('cards', () => {
  it('mọi biến thể trong catalog không vi phạm trợ năng', async () => {
    for (const entry of [channelTagCatalog, usageMeterCatalog, ideaCardCatalog, postCardCatalog]) {
      for (const v of entry.variants) {
        const { container, unmount } = render(<main>{v.render()}</main>);
        expect(await axe(container), `${entry.name}/${v.label}`).toHaveNoViolations();
        unmount();
      }
    }
  });
  it('catalog ChannelTag đủ 8 biến thể', () => {
    expect(channelTagCatalog.variants).toHaveLength(8);
  });
});

describe('ChannelTag', () => {
  it('đăng tay hiện chữ "Đăng tay"', () => {
    render(<ChannelTag channel="tiktok" manualPublish />);
    expect(screen.getByText('TikTok')).toBeInTheDocument();
    expect(screen.getByText(/Đăng tay/)).toBeInTheDocument();
  });
});

describe('UsageMeter', () => {
  it('có aria-valuenow và chữ cho mức cảnh báo/hết (không chỉ màu)', () => {
    const { rerender } = render(<UsageMeter label="Bài" value={85} limit={100} level="warning" />);
    expect(screen.getByRole('progressbar', { name: 'Bài' })).toHaveAttribute('aria-valuenow', '85');
    expect(screen.getByText('Sắp hết')).toBeInTheDocument();
    rerender(<UsageMeter label="Bài" value={100} limit={100} level="exhausted" />);
    expect(screen.getByText('Đã hết')).toBeInTheDocument();
  });
  // 015 T057 (FR-031, SC-004): trạng thái khóa AI có NHÃN CHỮ + BIỂU TƯỢNG, không chỉ màu; chỉ phần trăm.
  describe('trạng thái AI theo phần trăm (015 US6)', () => {
    it('80% (warning): chữ "Sắp hết" + biểu tượng cảnh báo + "80%"', () => {
      const { container } = render(
        <UsageMeter label="Lượt AI" value={80} limit={100} level="warning" unit="percent" />,
      );
      expect(screen.getByText('Sắp hết')).toBeInTheDocument();
      expect(screen.getByText('80%')).toBeInTheDocument();
      expect(container.querySelector('svg')).not.toBeNull();
    });
    it('100% (exhausted = AI bị khóa): chữ "Đã hết" + biểu tượng + "100%", không chỉ dựa vào màu', () => {
      const { container } = render(
        <UsageMeter label="Lượt AI" value={100} limit={100} level="exhausted" unit="percent" />,
      );
      expect(screen.getByText('Đã hết')).toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();
      expect(container.querySelector('svg')).not.toBeNull();
      expect(screen.getByRole('progressbar', { name: 'Lượt AI' })).toHaveAttribute(
        'aria-valuetext',
        '100%',
      );
    });
    it('bình thường: không nhãn cảnh báo, không biểu tượng cảnh báo', () => {
      const { container } = render(
        <UsageMeter label="Lượt AI" value={30} limit={100} level="normal" unit="percent" />,
      );
      expect(screen.queryByText('Sắp hết')).toBeNull();
      expect(screen.queryByText('Đã hết')).toBeNull();
      expect(container.querySelector('svg')).toBeNull();
    });
    it('giá trị không nguyên: 29/100 hiện 29%, 99,9/100 hiện 99% (cắt xuống, không làm tròn lên thành 100%)', () => {
      const { unmount } = render(
        <UsageMeter label="Lượt AI" value={29} limit={100} level="normal" unit="percent" />,
      );
      expect(screen.getByText('29%')).toBeInTheDocument();
      unmount();
      render(
        <UsageMeter label="Lượt AI" value={99.9} limit={100} level="warning" unit="percent" />,
      );
      expect(screen.getByText('99%')).toBeInTheDocument();
      expect(screen.queryByText('100%')).toBeNull();
    });
    it('mọi mức ở dạng phần trăm không chứa số tiền/đơn vị tiền', () => {
      for (const level of ['normal', 'warning', 'exhausted'] as const) {
        const { container, unmount } = render(
          <UsageMeter label="Lượt AI" value={99} limit={100} level={level} unit="percent" />,
        );
        expect(container.textContent).not.toMatch(/\$|USD|micro|đ\b|₫/i);
        unmount();
      }
    });
  });
  it('không nhận/hiển thị số tiền', () => {
    const { container } = render(
      <UsageMeter label="Lượt AI" value={3} limit={10} level="normal" />,
    );
    expect(container.textContent).not.toMatch(/\$|USD|đ\b/);
  });
});

describe('IdeaCard', () => {
  it('chọn / sửa / bỏ gọi đúng callback', () => {
    const idea = { id: 'i', title: 'Chủ đề A' };
    const onSelect = vi.fn();
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    render(<IdeaCard idea={idea} onSelect={onSelect} onEdit={onEdit} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chủ đề A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sửa: Chủ đề A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ: Chủ đề A' }));
    expect(onSelect).toHaveBeenCalledWith(idea);
    expect(onEdit).toHaveBeenCalledWith(idea);
    expect(onRemove).toHaveBeenCalledWith(idea);
  });
});

describe('PostCard', () => {
  const post = {
    id: 'p',
    title: 'Tiêu đề bài',
    excerpt: 'Tóm tắt',
    status: 'trang-thai-la',
    channels: ['facebook'],
    scheduledAt: '2026-11-20T02:00:00Z',
  };
  it('trạng thái lạ → nhãn trung tính; giờ hiển thị UTC+7', () => {
    render(<PostCard post={post} />);
    expect(screen.getByText('Đang cập nhật')).toBeInTheDocument();
    expect(screen.getByText('09:00 20/11/2026')).toBeInTheDocument();
  });
  it('mở bài qua nút', () => {
    const onOpen = vi.fn();
    render(<PostCard post={post} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tiêu đề bài' }));
    expect(onOpen).toHaveBeenCalledWith(post);
  });
});

describe('PostCard – trạng thái lạ (US5)', () => {
  it('trạng thái máy chủ không biết → nhãn trung tính "Đang cập nhật", không trắng trang', () => {
    const status = toDisplayStatus('trang_thai_la_tu_may_chu');
    expect(status).toBe('unknown');
    render(
      <PostCard
        post={{ id: 'x', title: 'Bài lạ', excerpt: '…', status, channels: ['facebook'] }}
      />,
    );
    expect(screen.getByText('Đang cập nhật')).toBeInTheDocument();
  });
});
