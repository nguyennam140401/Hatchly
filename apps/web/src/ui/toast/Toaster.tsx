import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';

// Lớp bọc `sonner` (FR-038). Toast CHỈ cho xác nhận ngắn như "Đã lưu"; lỗi có hành động dùng InlineAlert.
export function Toaster() {
  return <SonnerToaster position="bottom-center" closeButton />;
}

export const toast = {
  success: (message: string): void => {
    sonnerToast.success(message);
  },
  info: (message: string): void => {
    sonnerToast(message);
  },
};
