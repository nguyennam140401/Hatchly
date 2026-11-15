import { t } from '../../lib/i18n/t';
import { cn } from '../util/cn';

export interface SkeletonProps {
  /** Hình dạng giống nội dung thật để bố cục không nhảy. */
  shape?: 'line' | 'card' | 'list';
  /** Số dòng/thẻ lặp (shape = line | list). */
  count?: number;
  className?: string;
}

function Block({ className }: { className: string }) {
  return <div aria-hidden="true" className={cn('rounded-md bg-surface-200 motion-safe:animate-pulse', className)} />;
}

/** Khung chờ: `aria-busy` + thông báo "Đang tải" cho bộ đọc màn hình; chuyển động chỉ khi `motion-safe`. */
export function Skeleton({ shape = 'line', count = 3, className }: SkeletonProps) {
  return (
    <div aria-busy="true" role="status" className={cn('flex flex-col gap-3', className)}>
      <span className="sr-only">{t('common.loading')}</span>
      {shape === 'card' && <Block className="h-touch w-full py-8" />}
      {shape === 'line' &&
        Array.from({ length: count }, (_, i) => <Block key={i} className="h-4 w-full" />)}
      {shape === 'list' &&
        Array.from({ length: count }, (_, i) => <Block key={i} className="h-topbar w-full" />)}
    </div>
  );
}
