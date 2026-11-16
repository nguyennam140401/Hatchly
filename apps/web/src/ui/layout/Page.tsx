import type { ReactNode } from 'react';
import { cn } from '../util/cn';

/** Vùng nội dung chính của một trang: đúng MỘT `<main>` mỗi trang (khung ứng dụng không tự thêm `main`). */
export function Page({
  children,
  className,
  busy = false,
}: {
  children: ReactNode;
  className?: string;
  /** Đang tải dữ liệu của cả trang: `aria-busy` trên `<main>`. */
  busy?: boolean;
}) {
  return (
    <main className={cn('flex min-w-0 flex-col gap-6', className)} aria-busy={busy || undefined}>
      {children}
    </main>
  );
}
