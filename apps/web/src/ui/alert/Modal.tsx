import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** `false`: không đóng được bằng Esc/bấm ra ngoài (hộp thoại hết phiên bắt buộc xử lý). */
  dismissible?: boolean;
  /** `alertdialog` cho hộp xác nhận cần người dùng quyết định (mặc định `dialog`). */
  role?: 'dialog' | 'alertdialog';
  children?: ReactNode;
}

/** Lớp bọc Radix Dialog (FR-038): giữ tiêu điểm trong hộp, tiêu đề + mô tả cho bộ đọc màn hình. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  dismissible = true,
  role = 'dialog',
  children,
}: ModalProps) {
  return (
    <Dialog.Root open={open} {...(onOpenChange !== undefined ? { onOpenChange } : {})}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink opacity-40" />
        <Dialog.Content
          role={role}
          onEscapeKeyDown={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-dvh w-full max-w-phone -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border border-line bg-surface-0 p-6"
        >
          <Dialog.Title className="text-heading text-ink">{title}</Dialog.Title>
          {description !== undefined ? (
            <Dialog.Description asChild>
              <div className="text-body text-ink-muted">{description}</div>
            </Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Nút đóng hộp (dùng trong `Modal`). */
export const ModalClose = Dialog.Close;
