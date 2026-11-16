import { useState, type ReactNode } from 'react';
import type { ErrorActionView } from '../../lib/catalogs/error-explanations';
import { t } from '../../lib/i18n/t';
import { Button } from '../button/Button';
import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../util/cn';

export interface SupportInfo {
  traceId: string;
  code?: string | undefined;
  detail?: string | undefined;
}

interface BaseProps {
  title?: string;
  children?: ReactNode;
  /** Thông tin cho "Chi tiết cho hỗ trợ" (thu gọn). Mã gốc CHỈ hiện ở đây. */
  support?: SupportInfo;
  /** Bấm một hành động; nếu không truyền, hành động `navigate` đi theo `href`. */
  onAction?: (action: ErrorActionView) => void;
  className?: string;
}

/** `tone="error"` BẮT BUỘC ≥ 1 hành động khắc phục (kiểu TypeScript – SC-010, nguyên tắc VI). */
export type InlineAlertProps = BaseProps &
  (
    | { tone: 'info' | 'warning'; actions?: ErrorActionView[] }
    | { tone: 'error'; actions: [ErrorActionView, ...ErrorActionView[]] }
  );

const TONE: Record<InlineAlertProps['tone'], { icon: IconName; classes: string }> = {
  info: { icon: 'info', classes: 'border-info bg-info-soft text-ink' },
  warning: { icon: 'alert', classes: 'border-warning bg-warning-soft text-ink' },
  error: { icon: 'alert', classes: 'border-danger bg-danger-soft text-ink' },
};

export function InlineAlert(props: InlineAlertProps) {
  const { tone, title, children, support, onAction, className } = props;
  const actions: ErrorActionView[] = props.actions ?? [];
  const toneInfo = TONE[tone];
  const [copied, setCopied] = useState(false);

  const copySupport = () => {
    if (support === undefined) return;
    const text = [support.code, support.traceId, support.detail].filter(Boolean).join(' · ');
    // Chỉ SAO CHÉP mã để người dùng tự gửi, không gửi dữ liệu ra ngoài (nguyên tắc VII).
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
    });
  };

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-md border p-4', toneInfo.classes, className)}
    >
      <Icon name={toneInfo.icon} className="mt-1" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {title !== undefined && <p className="text-label font-semibold">{title}</p>}
        {children !== undefined && <div className="text-body-sm">{children}</div>}
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) =>
              action.kind === 'navigate' && action.href !== undefined ? (
                <a
                  key={action.label}
                  href={action.href}
                  onClick={(event) => {
                    // Có `onAction` thì để nơi gọi điều hướng trong SPA (không tải lại trang).
                    if (onAction === undefined) return;
                    event.preventDefault();
                    onAction(action);
                  }}
                  className="inline-flex min-h-touch min-w-touch items-center rounded-md border border-line-strong bg-surface-0 px-4 text-label text-brand focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {action.label}
                </a>
              ) : (
                <Button
                  key={action.label}
                  variant="secondary"
                  onClick={() => {
                    onAction?.(action);
                  }}
                >
                  {action.label}
                </Button>
              ),
            )}
          </div>
        )}
        {support !== undefined && (
          <details className="text-caption text-ink-muted">
            <summary className="min-h-touch cursor-pointer py-3 text-label">
              {t('support.detailsTitle')}
            </summary>
            <dl className="flex flex-col gap-1 pb-2">
              {support.code !== undefined && (
                <div>
                  <dt className="inline">{t('support.errorCode')}: </dt>
                  <dd className="inline">{support.code}</dd>
                </div>
              )}
              <div>
                <dt className="inline">{t('support.traceId')}: </dt>
                <dd className="inline">{support.traceId}</dd>
              </div>
            </dl>
            <Button variant="ghost" icon="copy" onClick={copySupport}>
              {t('support.send')}
            </Button>
            {copied && <p role="status">{t('support.copied')}</p>}
          </details>
        )}
      </div>
    </div>
  );
}
