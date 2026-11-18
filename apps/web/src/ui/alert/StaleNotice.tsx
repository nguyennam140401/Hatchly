import { t } from '../../lib/i18n/t';
import { InlineAlert } from './InlineAlert';

export interface StaleNoticeProps {
  /** Tiêu đề (mặc định "Bài viết đã được thay đổi"). */
  title?: string;
  /** Xem bản mới nhất. Thao tác ghi CHƯA thực hiện cho đến khi người dùng xem lại và xác nhận làm tiếp. */
  onViewLatest: () => void;
  children?: string;
}

/**
 * Bản ghi đã bị người khác sửa (409 VERSION_CONFLICT) khi duyệt/đăng trên bản cũ: KHÔNG thực hiện thao tác, chỉ cảnh báo
 * và dẫn tới bản mới. Nhờ vậy 0 lần duyệt/đăng nhầm trên bản cũ.
 */
export function StaleNotice({ title, onViewLatest, children }: StaleNoticeProps) {
  return (
    <InlineAlert
      tone="warning"
      title={title ?? t('stale.title')}
      actions={[{ kind: 'retry', label: t('stale.view') }]}
      onAction={onViewLatest}
    >
      {children}
    </InlineAlert>
  );
}
