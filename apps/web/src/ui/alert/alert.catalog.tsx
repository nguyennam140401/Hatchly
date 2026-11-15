import { useState } from 'react';
import { Button } from '../button/Button';
import type { CatalogEntry } from '../catalog-types';
import { ConfirmDialog } from './ConfirmDialog';
import { InlineAlert } from './InlineAlert';

export const inlineAlertCatalog: CatalogEntry = {
  name: 'InlineAlert',
  description: 'Cảnh báo nội dòng: thông tin / cảnh báo / lỗi (lỗi bắt buộc có hành động khắc phục).',
  a11yNotes: 'Lỗi dùng role="alert", còn lại role="status". Mã gốc chỉ trong "Chi tiết cho hỗ trợ".',
  variants: [
    { label: 'info', render: () => <InlineAlert tone="info" title="Lưu ý">Bài sẽ đăng lúc 09:00.</InlineAlert> },
    {
      label: 'warning',
      render: () => (
        <InlineAlert tone="warning" title="Sắp hết hạn" actions={[{ kind: 'retry', label: 'Kết nối lại' }]}>
          Kênh Facebook còn 3 ngày.
        </InlineAlert>
      ),
    },
    {
      label: 'error',
      render: () => (
        <InlineAlert
          tone="error"
          title="Chưa đăng được"
          actions={[{ kind: 'retry', label: 'Thử lại' }]}
          support={{ traceId: '018f-trace', code: 'PUBLISH_FAILED' }}
        >
          Facebook chưa nhận bài. Bạn thử lại nhé.
        </InlineAlert>
      ),
    },
  ],
};

function DialogDemo({ tone }: { tone: 'default' | 'danger' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => { setOpen(true); }}>
        Mở hộp thoại
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone={tone}
        title="Xóa bài này?"
        body="Bài sẽ biến mất khỏi lịch."
        confirmLabel="Xóa"
        onConfirm={() => { setOpen(false); }}
      />
    </>
  );
}

export const confirmDialogCatalog: CatalogEntry = {
  name: 'ConfirmDialog',
  description: 'Hộp thoại xác nhận (chưa có trong Figma – dựng theo token).',
  a11yNotes: 'Radix Dialog: giữ tiêu điểm trong hộp, Esc đóng, tiêu đề + mô tả được đọc.',
  variants: [
    { label: 'mặc định', render: () => <DialogDemo tone="default" /> },
    { label: 'nguy hiểm', render: () => <DialogDemo tone="danger" /> },
  ],
};
