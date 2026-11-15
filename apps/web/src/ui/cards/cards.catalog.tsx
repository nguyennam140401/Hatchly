import { CHANNEL_IDS } from '../../lib/catalogs/channels';
import type { CatalogEntry } from '../catalog-types';
import { ChannelTag } from './ChannelTag';
import { IdeaCard } from './IdeaCard';
import { PostCard } from './PostCard';
import { UsageMeter } from './UsageMeter';

export const channelTagCatalog: CatalogEntry = {
  name: 'ChannelTag',
  description: 'Thẻ kênh: 4 kênh × đăng tay có/không (8 biến thể).',
  a11yNotes: 'Nhận diện bằng chữ, không dùng màu kênh.',
  variants: CHANNEL_IDS.flatMap((channel) =>
    [false, true].map((manualPublish) => ({
      label: `${channel}${manualPublish ? ' · đăng tay' : ''}`,
      render: () => <ChannelTag channel={channel} manualPublish={manualPublish} />,
    })),
  ),
};

export const usageMeterCatalog: CatalogEntry = {
  name: 'UsageMeter',
  description: 'Thanh mức sử dụng: bình thường / cảnh báo / hết. Chỉ số đếm hoặc %, không số tiền.',
  a11yNotes: 'role="progressbar" có aria-valuenow; mức cảnh báo/hết có chữ + biểu tượng, không chỉ màu.',
  variants: [
    { label: 'bình thường', render: () => <UsageMeter label="Bài đăng" value={20} limit={100} level="normal" /> },
    { label: 'cảnh báo', render: () => <UsageMeter label="Bài đăng" value={85} limit={100} level="warning" /> },
    { label: 'hết', render: () => <UsageMeter label="Bài đăng" value={100} limit={100} level="exhausted" /> },
    { label: 'phần trăm', render: () => <UsageMeter label="Lượt AI" value={50} limit={100} level="normal" unit="percent" /> },
  ],
};

const idea = { id: 'i1', title: 'Khuyến mãi cuối tuần', reason: 'Khách thường mua nhiều vào thứ Bảy.' };

export const ideaCardCatalog: CatalogEntry = {
  name: 'IdeaCard',
  description: 'Thẻ chủ đề đề xuất: nổi bật có/không.',
  a11yNotes: 'Nút chọn/sửa/bỏ có nhãn riêng; chọn dùng aria-pressed.',
  variants: [
    { label: 'thường', render: () => <IdeaCard idea={idea} onSelect={() => undefined} onEdit={() => undefined} onRemove={() => undefined} /> },
    { label: 'nổi bật', render: () => <IdeaCard idea={idea} featured onSelect={() => undefined} /> },
    { label: 'đang chọn', render: () => <IdeaCard idea={idea} selected onSelect={() => undefined} /> },
  ],
};

export const postCardCatalog: CatalogEntry = {
  name: 'PostCard',
  description: 'Thẻ bài viết với trạng thái, kênh, giờ đăng.',
  a11yNotes: 'Tiêu đề dài cắt gọn có Tooltip; mở bài bằng nút có vùng chạm ≥ 44 px.',
  variants: [
    {
      label: 'đã lên lịch',
      render: () => (
        <PostCard
          post={{
            id: 'p1',
            title: 'Ra mắt bộ sưu tập mới',
            excerpt: 'Mời bạn ghé xem bộ sưu tập mùa thu.',
            status: 'scheduled',
            channels: ['facebook', 'instagram'],
            scheduledAt: '2026-11-20T02:00:00Z',
          }}
          onOpen={() => undefined}
        />
      ),
    },
    {
      label: 'tiêu đề rất dài',
      render: () => (
        <PostCard
          post={{
            id: 'p2',
            title: 'Một tiêu đề rất rất dài để kiểm tra việc cắt gọn trên màn hình điện thoại 360 px không bị tràn',
            excerpt: 'Nội dung ngắn.',
            status: 'attention',
            channels: ['tiktok'],
          }}
          onOpen={() => undefined}
        />
      ),
    },
  ],
};
