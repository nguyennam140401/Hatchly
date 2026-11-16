import { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { Button } from '../../ui/button/Button';
import { Field } from '../../ui/field/Field';
import { useFieldMeta } from '../../ui/form/fields/use-field';

/** Ô mật khẩu có nút hiện/ẩn (aria-pressed); `autoComplete` do trang truyền (current/new-password). */
export function PasswordField({
  name,
  label,
  autoComplete,
  help,
}: {
  name: string;
  label: string;
  autoComplete: 'current-password' | 'new-password';
  help?: string;
}) {
  const { register } = useFormContext();
  const { error, readOnly } = useFieldMeta(name);
  const [visible, setVisible] = useState(false);
  return (
    <Field
      label={label}
      {...(help !== undefined ? { help } : {})}
      error={error}
      state={readOnly ? 'readOnly' : 'default'}
    >
      {(c) => (
        <div className="flex gap-2">
          <input
            {...register(name)}
            {...c}
            type={visible ? 'text' : 'password'}
            autoComplete={autoComplete}
            className={`${c.className} flex-1`}
          />
          <Button
            variant="secondary"
            aria-pressed={visible}
            aria-controls={c.id}
            aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            onClick={() => {
              setVisible((v) => !v);
            }}
          >
            {visible ? 'Ẩn' : 'Hiện'}
          </Button>
        </div>
      )}
    </Field>
  );
}
