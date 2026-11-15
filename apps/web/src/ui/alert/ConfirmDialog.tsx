import type { ReactNode } from 'react';
import { t } from '../../lib/i18n/t';
import { Button } from '../button/Button';
import { Modal, ModalClose } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tone?: 'default' | 'danger';
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  loading?: boolean;
}

/** Hộp thoại xác nhận (Radix Dialog): giữ tiêu điểm, Esc đóng. Thao tác nguy hiểm dùng `tone="danger"`. */
export function ConfirmDialog({
  open,
  onOpenChange,
  tone = 'default',
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={body}>
      <div className="flex flex-wrap justify-end gap-2">
        <ModalClose asChild>
          <Button variant="secondary">{cancelLabel ?? t('common.cancel')}</Button>
        </ModalClose>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
