import type { ReactNode } from 'react';
import { t } from '../../lib/i18n/t';
import { InlineAlert } from '../alert/InlineAlert';

export interface ConflictNoticeProps {
  /** Đã nạp bản mới nhất vào form → chỉ còn khung đối chiếu. */
  loaded: boolean;
  /** "Bản của bạn" – nội dung người dùng đang nhập, chỉ đọc. */
  mine: ReactNode;
  onLoadLatest: () => void;
  onKeepMine: () => void;
  onDismiss: () => void;
}

/**
 * Xung đột phiên bản (FR-018): người khác vừa sửa cùng bản ghi. KHÔNG tự ghi đè, KHÔNG tự gửi lại.
 * Hai lựa chọn: "Tải bản mới nhất" (giữ bản của tôi trong khung đối chiếu) hoặc "Giữ bản của tôi để xem lại".
 */
export function ConflictNotice({ loaded, mine, onLoadLatest, onKeepMine, onDismiss }: ConflictNoticeProps) {
  return (
    <div className="flex flex-col gap-3">
      <InlineAlert
        tone="warning"
        title={t('form.conflict.title')}
        actions={
          loaded
            ? [{ kind: 'retry', label: t('common.close') }]
            : [
                { kind: 'retry', label: t('form.conflict.load') },
                { kind: 'navigate', label: t('form.conflict.keep') },
              ]
        }
        onAction={(action) => {
          if (loaded) onDismiss();
          else if (action.kind === 'retry') onLoadLatest();
          else onKeepMine();
        }}
      />
      <section aria-label={t('form.conflict.mine')} className="rounded-md border border-line bg-surface-100 p-4">
        <h3 className="pb-2 text-label text-ink">{t('form.conflict.mine')}</h3>
        <div className="text-body-sm text-ink-muted">{mine}</div>
      </section>
    </div>
  );
}
