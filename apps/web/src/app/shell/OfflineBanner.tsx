import { useOnline } from '../../lib/api/connectivity';
import { t } from '../../lib/i18n/t';
import { InlineAlert } from '../../ui/alert/InlineAlert';

/** Mất mạng: dữ liệu đã tải vẫn xem được; hiện "Dữ liệu có thể chưa mới" + "Thử lại". */
export function OfflineBanner({ onRetry }: { onRetry: () => void }) {
  const online = useOnline();
  if (online) return null;
  return (
    <InlineAlert
      tone="warning"
      actions={[{ kind: 'retry', label: t('common.retry') }]}
      onAction={onRetry}
      className="m-gutter"
    >
      {t('offline.banner')}
    </InlineAlert>
  );
}
