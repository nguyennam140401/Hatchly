import { useId, useState, type KeyboardEvent } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { Button } from '../../button/Button';
import { Chip } from '../../chip-tabs/Chip';
import { Field } from '../../field/Field';
import { useFieldMeta } from './use-field';

export interface TagListFieldProps {
  name: string;
  label: string;
  help?: string;
  /** Số thẻ tối đa. */
  max?: number;
  placeholder?: string;
  addLabel?: string;
}

/** Danh sách thẻ (từ khóa/hashtag): Enter hoặc dấu phẩy để thêm, nút × để bỏ; dùng được hoàn toàn bằng bàn phím. */
export function TagListField({ name, label, help, max, placeholder, addLabel = 'Thêm' }: TagListFieldProps) {
  const { control } = useFormContext();
  const { error, readOnly } = useFieldMeta(name);
  const [draft, setDraft] = useState('');
  const listId = useId();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const tags: string[] = Array.isArray(field.value) ? (field.value as string[]) : [];
        const full = max !== undefined && tags.length >= max;
        const add = () => {
          const value = draft.trim();
          if (value === '' || full || tags.includes(value)) return;
          field.onChange([...tags, value]);
          setDraft('');
        };
        const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            add();
          }
          if (event.key === 'Backspace' && draft === '' && tags.length > 0 && !readOnly) {
            field.onChange(tags.slice(0, -1));
          }
        };
        return (
          <div className="flex flex-col gap-2">
            <Field
              label={label}
              {...(help !== undefined ? { help } : {})}
              error={error}
              state={readOnly ? 'readOnly' : 'default'}
            >
              {(c) => (
                <div className="flex gap-2">
                  <input
                    {...c}
                    ref={field.ref}
                    type="text"
                    value={draft}
                    readOnly={readOnly}
                    disabled={full}
                    onChange={(e) => {
                      setDraft(e.target.value);
                    }}
                    onKeyDown={onKeyDown}
                    onBlur={field.onBlur}
                    {...(placeholder !== undefined ? { placeholder } : {})}
                  />
                  {!readOnly && (
                    <Button variant="secondary" onClick={add} locked={full} lockedReason={full ? `Tối đa ${String(max)}` : undefined}>
                      {addLabel}
                    </Button>
                  )}
                </div>
              )}
            </Field>
            <ul id={listId} aria-label={label} className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <li key={tag}>
                  <Chip
                    label={tag}
                    {...(readOnly
                      ? {}
                      : {
                          onRemove: () => {
                            field.onChange(tags.filter((x) => x !== tag));
                          },
                        })}
                  />
                </li>
              ))}
            </ul>
            {max !== undefined && (
              <p className="text-caption text-ink-muted">
                {tags.length}/{max}
              </p>
            )}
          </div>
        );
      }}
    />
  );
}
