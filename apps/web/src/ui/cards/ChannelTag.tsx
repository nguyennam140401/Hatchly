import { channelLabel } from '../../lib/catalogs/channels';
import { t } from '../../lib/i18n/t';
import { cn } from '../util/cn';

export interface ChannelTagProps {
  /** Mã kênh (facebook·instagram·tiktok·zalo). */
  channel: string;
  /** Do máy chủ báo (kênh chỉ hỗ trợ đăng tay) – không có công tắc ở giao diện. */
  manualPublish?: boolean;
  className?: string;
}

/** Kênh nhận diện bằng CHỮ, không dùng màu riêng của kênh. */
export function ChannelTag({ channel, manualPublish = false, className }: ChannelTagProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill border border-line bg-surface-0 px-3 text-label text-ink',
        className,
      )}
    >
      <span>{channelLabel(channel)}</span>
      {manualPublish && <span className="text-caption text-ink-muted">· {t('common.manualPublish')}</span>}
    </span>
  );
}
