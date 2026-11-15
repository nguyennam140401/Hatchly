import type { IconName } from '../icons/Icon';

/** Mục điều hướng ở dạng hiển thị (đã lọc theo quyền và dịch chữ bởi `app/shell`). */
export interface NavItemView {
  id: string;
  label: string;
  icon: IconName;
  href: string;
  /** Số đếm trên huy hiệu (chờ duyệt, thông báo chưa đọc); 0/undefined → không hiện. */
  badge?: number | undefined;
  /** "Tạo bài": nổi bật ở giữa thanh dưới. */
  featured?: boolean | undefined;
}
