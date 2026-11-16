import { useId, type ReactNode } from 'react';
import { useFormContext } from 'react-hook-form';
import { Icon } from '../../icons/Icon';
import { useFieldMeta } from './use-field';

export interface CheckboxFieldProps {
  name: string;
  label: string;
  /** Lời giải thích bên cạnh (vd bên nhận dữ liệu của ô đồng ý); gắn vào ô bằng `aria-describedby`. */
  description?: ReactNode;
}

/** Hộp kiểm đơn (vd đồng ý điều khoản): KHÔNG BAO GIỜ đặt sẵn; lỗi gắn với ô qua `aria-describedby`. */
export function CheckboxField({ name, label, description }: CheckboxFieldProps) {
  const { register } = useFormContext();
  const { error, readOnly } = useFieldMeta(name);
  const id = useId();
  const describedBy =
    [
      description !== undefined ? `${id}-note` : undefined,
      error !== undefined ? `${id}-error` : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className="flex items-start gap-3">
      <input
        {...register(name)}
        id={id}
        type="checkbox"
        disabled={readOnly}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy}
        className="mt-2 size-6 shrink-0 accent-brand focus-visible:ring-2 focus-visible:ring-brand"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className="min-h-touch py-2 text-body text-ink">
          {label}
        </label>
        {description !== undefined && (
          <div id={`${id}-note`} className="text-caption text-ink-muted">
            {description}
          </div>
        )}
        {error !== undefined && (
          <p id={`${id}-error`} className="flex items-start gap-1 text-body-sm text-danger">
            <Icon name="alert" className="mt-1 size-4" />
            <span>{error.message}</span>
          </p>
        )}
      </div>
    </div>
  );
}
