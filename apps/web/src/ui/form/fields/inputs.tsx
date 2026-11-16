import { Controller, useFormContext } from 'react-hook-form';
import { fromLocalInput, toLocalInput } from '../../../lib/format/datetime';
import { cn } from '../../util/cn';
import { Field } from '../../field/Field';
import { useFieldMeta } from './use-field';

// Họ ô nhập (FR-013): mỗi ô dựng trên `Field` – nhãn `for`, trợ giúp/lỗi `aria-describedby`, `aria-invalid`, dấu `*`.

interface CommonProps {
  name: string;
  label: string;
  help?: string;
  required?: boolean;
}

export interface TextFieldProps extends CommonProps {
  type?: 'text' | 'email' | 'tel' | 'url' | 'search';
  autoComplete?: string;
  placeholder?: string;
}

export function TextField({
  name,
  label,
  help,
  required,
  type = 'text',
  autoComplete,
  placeholder,
}: TextFieldProps) {
  const { register } = useFormContext();
  const { error, readOnly } = useFieldMeta(name);
  return (
    <Field
      label={label}
      {...(help !== undefined ? { help } : {})}
      error={error}
      {...(required !== undefined ? { required } : {})}
      state={readOnly ? 'readOnly' : 'default'}
    >
      {(c) => (
        <input
          {...register(name)}
          {...c}
          type={type}
          readOnly={readOnly}
          aria-readonly={readOnly || undefined}
          {...(autoComplete !== undefined ? { autoComplete } : {})}
          {...(placeholder !== undefined ? { placeholder } : {})}
        />
      )}
    </Field>
  );
}

export interface TextAreaFieldProps extends CommonProps {
  /** Giới hạn ký tự: hiện bộ đếm, `aria-live="polite"` khi ≥ 90% (hành vi của 006). */
  maxChars?: number;
  rows?: number;
}

export function TextAreaField({
  name,
  label,
  help,
  required,
  maxChars,
  rows = 4,
}: TextAreaFieldProps) {
  const { register, watch } = useFormContext();
  const { error, readOnly } = useFieldMeta(name);
  const value = watch(name) as unknown;
  const count = typeof value === 'string' ? Array.from(value).length : 0;
  const near = maxChars !== undefined && count >= maxChars * 0.9;
  return (
    <div className="flex flex-col gap-1">
      <Field
        label={label}
        {...(help !== undefined ? { help } : {})}
        error={error}
        {...(required !== undefined ? { required } : {})}
        state={readOnly ? 'readOnly' : 'default'}
      >
        {(c) => (
          <textarea
            {...register(name)}
            {...c}
            rows={rows}
            readOnly={readOnly}
            aria-readonly={readOnly || undefined}
          />
        )}
      </Field>
      {maxChars !== undefined && (
        <p
          aria-live={near ? 'polite' : 'off'}
          className={cn('text-caption', count > maxChars ? 'text-danger' : 'text-ink-muted')}
        >
          {count}/{maxChars}
        </p>
      )}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

export interface SelectFieldProps extends CommonProps {
  options: readonly Option[];
  placeholder?: string;
}

/** Dùng phần tử `<select>` gốc (tốt nhất cho bàn phím, bộ đọc màn hình và điện thoại). */
export function SelectField({
  name,
  label,
  help,
  required,
  options,
  placeholder,
}: SelectFieldProps) {
  const { register } = useFormContext();
  const { error, readOnly } = useFieldMeta(name);
  return (
    <Field
      label={label}
      {...(help !== undefined ? { help } : {})}
      error={error}
      {...(required !== undefined ? { required } : {})}
      state={readOnly ? 'readOnly' : 'default'}
    >
      {(c) => (
        <select
          {...register(name)}
          {...c}
          disabled={readOnly}
          aria-readonly={readOnly || undefined}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export interface MultiSelectFieldProps extends CommonProps {
  options: readonly Option[];
}

/** Nhóm hộp kiểm: giá trị là mảng các `value` đã chọn. */
export function MultiSelectField({ name, label, help, required, options }: MultiSelectFieldProps) {
  const { register } = useFormContext();
  const { error, readOnly } = useFieldMeta(name);
  return (
    <fieldset className="flex flex-col gap-1" aria-required={required ?? undefined}>
      <legend className="text-label text-ink">{label}</legend>
      {help !== undefined && <p className="text-caption text-ink-muted">{help}</p>}
      {options.map((o) => (
        <label key={o.value} className="flex min-h-touch items-center gap-3 text-body text-ink">
          <input
            type="checkbox"
            value={o.value}
            disabled={readOnly}
            {...register(name)}
            className="size-6"
          />
          {o.label}
        </label>
      ))}
      {error !== undefined && (
        <p role="alert" className="text-body-sm text-danger">
          {error.message}
        </p>
      )}
    </fieldset>
  );
}

export type DateTimeFieldProps = CommonProps;

/** Hiển thị giờ UTC+7; giá trị lưu trong form là ISO UTC. */
export function DateTimeField({ name, label, help, required }: DateTimeFieldProps) {
  const { control } = useFormContext();
  const { error, readOnly } = useFieldMeta(name);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field
          label={label}
          {...(help !== undefined ? { help } : {})}
          error={error}
          {...(required !== undefined ? { required } : {})}
          state={readOnly ? 'readOnly' : 'default'}
        >
          {(c) => (
            <input
              {...c}
              type="datetime-local"
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              readOnly={readOnly}
              value={
                typeof field.value === 'string' && field.value !== ''
                  ? toLocalInput(field.value)
                  : ''
              }
              onChange={(e) => {
                field.onChange(e.target.value === '' ? '' : fromLocalInput(e.target.value));
              }}
            />
          )}
        </Field>
      )}
    />
  );
}
