import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { t } from '../../lib/i18n/t';
import { Button } from '../button/Button';

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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink opacity-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex w-full max-w-phone -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-line bg-surface-0 p-6">
          <Dialog.Title className="text-heading text-ink">{title}</Dialog.Title>
          {body !== undefined ? (
            <Dialog.Description asChild>
              <div className="text-body text-ink-muted">{body}</div>
            </Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary">{cancelLabel ?? t('common.cancel')}</Button>
            </Dialog.Close>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={loading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
