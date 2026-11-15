import { Button } from '../button/Button';
import type { CatalogEntry } from '../catalog-types';
import { PageHeader } from '../layout/PageHeader';
import { ChannelRow } from './ChannelRow';

export const channelRowCatalog: CatalogEntry = {
  name: 'ChannelRow',
  description: 'Dòng kênh: đã kết nối / sắp hết hạn / chưa kết nối / đăng tay.',
  a11yNotes: 'Trạng thái bằng chữ + biểu tượng.',
  variants: [
    { label: 'đã kết nối', render: () => <ChannelRow channel="facebook" state="connected" detail="Trang Tiệm Hoa" action={<Button variant="ghost">Ngắt</Button>} /> },
    { label: 'sắp hết hạn', render: () => <ChannelRow channel="instagram" state="expiring" detail="Còn 3 ngày" action={<Button variant="secondary">Kết nối lại</Button>} /> },
    { label: 'chưa kết nối', render: () => <ChannelRow channel="zalo" state="disconnected" action={<Button>Kết nối</Button>} /> },
    { label: 'đăng tay', render: () => <ChannelRow channel="tiktok" state="manual" detail="Bạn đăng thủ công" /> },
  ],
};

export const pageHeaderCatalog: CatalogEntry = {
  name: 'PageHeader',
  description: 'Tiêu đề trang (h1) + mô tả + hành động.',
  a11yNotes: 'Mỗi trang có đúng một h1.',
  variants: [
    { label: 'đầy đủ', render: () => <PageHeader title="Bài viết" description="Mọi bài của bạn." actions={<Button>Tạo bài</Button>} /> },
    { label: 'chỉ tiêu đề', render: () => <PageHeader title="Cài đặt" /> },
  ],
};
