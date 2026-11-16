import type { CatalogEntry } from '../catalog-types';
import { Button } from './Button';

const VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const;

export const buttonCatalog: CatalogEntry = {
  name: 'Button',
  description: 'Nút bấm: 4 kiểu × mặc định/khóa, thêm trạng thái đang lưu.',
  a11yNotes:
    'Vùng chạm ≥ 44 px. Nút khóa dùng aria-disabled (vẫn focus được) và có dòng lý do liên kết bằng aria-describedby.',
  variants: [
    ...VARIANTS.map((variant) => ({
      label: `${variant} – mặc định`,
      render: () => <Button variant={variant}>Lưu</Button>,
    })),
    ...VARIANTS.map((variant) => ({
      label: `${variant} – khóa`,
      render: () => (
        <Button variant={variant} locked lockedReason="Chỉ chủ tài khoản mới dùng được">
          Lưu
        </Button>
      ),
    })),
    { label: 'đang lưu', render: () => <Button loading>Lưu</Button> },
    {
      label: 'khóa có ngày mở lại',
      render: () => (
        <Button locked lockedReason="Đã hết lượt AI." reopensAt={new Date('2026-12-01T00:00:00Z')}>
          Tạo bài bằng AI
        </Button>
      ),
    },
  ],
};
