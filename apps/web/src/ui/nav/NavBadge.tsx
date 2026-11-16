import { formatCount } from '../../lib/format/number';

/** Huy hiệu đếm: có chữ số thật (đọc được bằng bộ đọc màn hình), không chỉ chấm màu. */
export function NavBadge({ count }: { count?: number | undefined }) {
  if (count === undefined || count <= 0) return null;
  return (
    <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-pill bg-danger px-2 text-caption text-on-brand">
      {count > 99 ? '99+' : formatCount(count)}
    </span>
  );
}
