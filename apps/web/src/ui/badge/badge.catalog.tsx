import { POST_DISPLAY_STATUSES } from '../../lib/catalogs/post-status';
import type { CatalogEntry } from '../catalog-types';
import { StatusBadge } from './StatusBadge';
import { SuggestionTag } from './SuggestionTag';

export const statusBadgeCatalog: CatalogEntry = {
  name: 'StatusBadge',
  description: 'Huy hiệu trạng thái bài: 8 trạng thái (Đã hủy và "Đang cập nhật" chưa có trong Figma).',
  a11yNotes: 'Luôn có chữ + biểu tượng; màu chỉ là phần phụ.',
  variants: [
    ...POST_DISPLAY_STATUSES.map((status) => ({
      label: status,
      render: () => <StatusBadge status={status} />,
    })),
    { label: 'cỡ nhỏ', render: () => <StatusBadge status="published" size="sm" /> },
    { label: 'trạng thái lạ', render: () => <StatusBadge status="mot-trang-thai-moi" /> },
  ],
};

export const suggestionTagCatalog: CatalogEntry = {
  name: 'SuggestionTag',
  description: 'Nhãn "Gợi ý hôm nay" (không thuộc bảng trạng thái bài).',
  a11yNotes: 'Chữ + biểu tượng bóng đèn.',
  variants: [{ label: 'mặc định', render: () => <SuggestionTag /> }],
};
