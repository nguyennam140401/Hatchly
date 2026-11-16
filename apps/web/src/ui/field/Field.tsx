import { useId, type ReactNode } from 'react';
import { t } from '../../lib/i18n/t';
import { Icon } from '../icons/Icon';
import { cn } from '../util/cn';

export type FieldState = 'default' | 'focus' | 'error' | 'disabled' | 'readOnly';

export interface FieldError {
  message: string;
  /** Cách sửa (lỗi luôn kèm cách sửa – nguyên tắc VI). */
  fix?: string;
}

/** Thuộc tính cần gắn vào phần tử nhập thật (input/textarea/select…). */
export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
  className: string;
}

export interface FieldProps {
  label: string;
  /** Mã ô; mặc định sinh tự động. */
  id?: string;
  help?: string;
  error?: FieldError | undefined;
  required?: boolean;
  /** Dựng sẵn trạng thái (danh mục/chế độ chỉ xem); lỗi suy ra từ `error`. */
  state?: FieldState;
  children: (control: FieldControlProps) => ReactNode;
  className?: string;
}

const CONTROL_BASE =
  // Cỡ chữ ô ≥ 16 px (text-body) để iOS không tự phóng to; cao ≥ 44 px.
  'min-h-touch w-full min-w-0 rounded-md border bg-surface-0 px-3 py-2 text-body text-ink placeholder:text-ink-muted ' +
  'focus-visible:ring-2 focus-visible:ring-brand motion-safe:transition-colors motion-safe:duration-fast';

const CONTROL_STATE: Record<FieldState, string> = {
  default: 'border-line-strong',
  focus: 'border-brand ring-2 ring-brand',
  error: 'border-danger',
  disabled: 'border-line bg-surface-200 text-ink-muted',
  readOnly: 'border-line bg-surface-100',
};

export function Field({
  label,
  id,
  help,
  error,
  required = false,
  state,
  children,
  className,
}: FieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const helpId = `${fieldId}-help`;
  const errorId = `${fieldId}-error`;
  const effective: FieldState = error !== undefined ? 'error' : (state ?? 'default');
  const describedBy =
    [error !== undefined ? errorId : undefined, help !== undefined ? helpId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={fieldId} className="text-label text-ink">
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="text-danger">
              {' '}
              *
            </span>
            <span className="sr-only"> ({t('common.required')})</span>
          </>
        )}
      </label>
      {children({
        id: fieldId,
        'aria-describedby': describedBy,
        'aria-invalid': error !== undefined ? true : undefined,
        'aria-required': required ? true : undefined,
        className: cn(CONTROL_BASE, CONTROL_STATE[effective]),
      })}
      {help !== undefined && (
        <p id={helpId} className="text-caption text-ink-muted">
          {help}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="flex items-start gap-1 text-body-sm text-danger">
          <Icon name="alert" className="mt-1 size-4" />
          <span>
            {error.message}
            {error.fix !== undefined && ` ${error.fix}`}
          </span>
        </p>
      )}
    </div>
  );
}
