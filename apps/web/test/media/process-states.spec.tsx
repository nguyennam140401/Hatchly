// 014 T060 (FR-012/014/025): ô thư viện hiện mọi kết quả xử lý bằng CHỮ + biểu tượng, kèm thông điệp + cách khắc phục theo
// từng mã `failure_code`; "Không xử lý được" luôn có nút Xóa (người dùng không bị kẹt).
import { UNPROCESSABLE_CODES, UNPROCESSABLE_MESSAGES } from '@app/shared/media';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaCard } from '../../src/features/media/MediaCard';
import { MediaGrid } from '../../src/features/media/MediaGrid';
import { mediaItem } from './helpers';

afterEach(cleanup);

describe('trạng thái xử lý của ô media', () => {
  it('processing → "Đang xử lý" (có biểu tượng), chưa có ảnh thu nhỏ, vẫn mở được chi tiết', async () => {
    const onOpen = vi.fn();
    const { container } = render(
      <ul>
        <MediaCard
          item={mediaItem(1, { status: 'processing', thumbUrl: null })}
          onOpen={onOpen}
          onDelete={() => undefined}
        />
      </ul>,
    );
    expect(screen.getByText('Đang xử lý').parentElement?.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^anh-1\.jpg, Ảnh, Đang xử lý$/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('ready → "Sẵn sàng" + ảnh thu nhỏ nạp lười', async () => {
    const { container } = render(
      <MediaGrid items={[mediaItem(1)]} onOpen={() => undefined} onDelete={() => undefined} />,
    );
    expect(screen.getByText('Sẵn sàng')).toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('loading', 'lazy');
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(UNPROCESSABLE_CODES)(
    'unprocessable (%s) → thông điệp + cách khắc phục từ bảng dùng chung + nút Xóa',
    async (code) => {
      const m = UNPROCESSABLE_MESSAGES[code];
      const onDelete = vi.fn();
      const { container } = render(
        <ul>
          <MediaCard
            item={mediaItem(2, {
              status: 'unprocessable',
              thumbUrl: null,
              failure: { code, title: m.title, action: m.action },
            })}
            onOpen={() => undefined}
            onDelete={onDelete}
          />
        </ul>,
      );
      const card = within(container);
      expect(card.getByText('Không xử lý được')).toBeInTheDocument();
      expect(card.getByText(m.action)).toBeInTheDocument();
      fireEvent.click(card.getByRole('button', { name: 'Xóa anh-2.jpg' }));
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('video có thời lượng m:ss và biểu tượng video', () => {
    render(
      <ul>
        <MediaCard
          item={mediaItem(3, {
            kind: 'video',
            durationMs: 125_000,
            thumbUrl: null,
            displayName: 'v.mp4',
          })}
          onOpen={() => undefined}
          onDelete={() => undefined}
        />
      </ul>,
    );
    expect(screen.getByText('2:05')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'v.mp4, Video, Sẵn sàng' })).toBeInTheDocument();
  });
});
