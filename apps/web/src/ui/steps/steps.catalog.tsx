import type { CatalogEntry } from '../catalog-types';
import { ProgressRow } from './ProgressRow';
import { StepRow } from './StepRow';

export const stepRowCatalog: CatalogEntry = {
  name: 'StepRow',
  description: 'Dòng bước của một lượt đăng: xong / lỗi / chờ (đang xử lý).',
  a11yNotes: 'Trạng thái bằng chữ + biểu tượng; nhấp nháy chỉ khi motion-safe, giảm chuyển động vẫn có chữ "Đang xử lý".',
  variants: [
    { label: 'xong', render: () => <StepRow state="done" title="Kiểm tra trước" time="09:00" /> },
    {
      label: 'lỗi',
      render: () => (
        <StepRow
          state="error"
          title="Gửi lên Facebook"
          time="09:01"
          explanation="Facebook chưa nhận bài."
          remedy="Kết nối lại trang rồi thử đăng lại."
        />
      ),
    },
    { label: 'chờ', render: () => <StepRow state="pending" title="Xác nhận" /> },
    { label: 'đang chạy', render: () => <StepRow state="pending" running title="Chờ xử lý" /> },
  ],
};

export const progressRowCatalog: CatalogEntry = {
  name: 'ProgressRow',
  description: 'Dòng tiến độ done/total (chưa có trong Figma).',
  a11yNotes: 'role="progressbar" có aria-valuenow và chữ số.',
  variants: [{ label: '3/10', render: () => <ProgressRow label="Đang tạo bài" done={3} total={10} /> }],
};
