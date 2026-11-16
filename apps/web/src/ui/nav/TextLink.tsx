import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '../util/cn';

export interface TextLinkProps {
  to: string;
  children: ReactNode;
  className?: string;
}

/** Liên kết chữ trong nội dung/biểu mẫu: vùng chạm ≥ 44 px, gạch chân, tiêu điểm nhìn thấy. Dùng `Link` của router. */
export function TextLink({ to, children, className }: TextLinkProps) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex min-h-touch items-center text-label text-brand underline focus-visible:ring-2 focus-visible:ring-brand',
        className,
      )}
    >
      {children}
    </Link>
  );
}
