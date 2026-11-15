import { t } from '../../lib/i18n/t';
import { Icon } from '../icons/Icon';
import { cn } from '../util/cn';

/** "Gợi ý hôm nay": tách khỏi bảng trạng thái bài, dùng chung kiểu dáng spark-soft/spark-ink. */
export function SuggestionTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill bg-spark-soft px-3 text-label font-semibold text-spark-ink',
        className,
      )}
    >
      <Icon name="bulb" className="size-4" />
      <span>{t('common.suggestionToday')}</span>
    </span>
  );
}
