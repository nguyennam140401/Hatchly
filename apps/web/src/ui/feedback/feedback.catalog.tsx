import { Button } from '../button/Button';
import type { CatalogEntry } from '../catalog-types';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';

export const skeletonCatalog: CatalogEntry = {
  name: 'Skeleton',
  description: 'Khung chờ cùng hình dạng nội dung (chưa có trong Figma – dựng theo token).',
  a11yNotes: 'aria-busy + "Đang tải" cho bộ đọc màn hình; nhấp nháy chỉ khi motion-safe.',
  variants: [
    { label: 'dòng', render: () => <Skeleton shape="line" /> },
    { label: 'thẻ', render: () => <Skeleton shape="card" /> },
    { label: 'danh sách', render: () => <Skeleton shape="list" count={3} /> },
  ],
};

export const emptyStateCatalog: CatalogEntry = {
  name: 'EmptyState',
  description: 'Trạng thái trống: lời nhắn + một hành động (chưa có trong Figma).',
  a11yNotes: 'Chữ + biểu tượng; hành động là nút có vùng chạm ≥ 44 px.',
  variants: [
    {
      label: 'có hành động',
      render: () => <EmptyState message="Bạn chưa có bài nào." action={<Button>Tạo bài đầu tiên</Button>} />,
    },
    { label: 'không hành động', render: () => <EmptyState message="Chưa có thông báo." /> },
  ],
};
