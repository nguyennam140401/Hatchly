import * as Switch from '@radix-ui/react-switch';
import { useId } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { cn } from '../../util/cn';
import { useFieldMeta } from './use-field';

export interface SwitchFieldProps {
  name: string;
  label: string;
  help?: string;
}

/** Công tắc bật/tắt (Radix Switch): `role="switch"`, nhãn gắn bằng `for`, trạng thái `aria-checked`. */
export function SwitchField({ name, label, help }: SwitchFieldProps) {
  const { control } = useFormContext();
  const { readOnly } = useFieldMeta(name);
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="flex flex-col gap-1">
          <div className="flex min-h-touch items-center justify-between gap-3">
            <label htmlFor={id} className="text-body text-ink">
              {label}
            </label>
            <Switch.Root
              id={id}
              checked={field.value === true}
              disabled={readOnly}
              onCheckedChange={field.onChange}
              onBlur={field.onBlur}
              aria-describedby={help !== undefined ? `${id}-help` : undefined}
              className={cn(
                'relative h-touch w-14 shrink-0 rounded-pill border border-line-strong focus-visible:ring-2 focus-visible:ring-brand',
                field.value === true ? 'bg-brand' : 'bg-surface-200',
              )}
            >
              <Switch.Thumb
                className={cn(
                  'block size-6 rounded-pill bg-surface-0 motion-safe:transition-transform motion-safe:duration-fast',
                  field.value === true ? 'translate-x-6' : 'translate-x-1',
                )}
              />
            </Switch.Root>
          </div>
          {help !== undefined && (
            <p id={`${id}-help`} className="text-caption text-ink-muted">
              {help}
            </p>
          )}
        </div>
      )}
    />
  );
}
