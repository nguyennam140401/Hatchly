import { useState } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { Button } from '../../button/Button';
import { IdeaCard } from '../../cards/IdeaCard';
import { Field } from '../../field/Field';
import { useFieldMeta } from './use-field';

export interface IdeaListFieldProps {
  name: string;
  label: string;
  addLabel?: string;
}

interface IdeaRow {
  id: string;
  title: string;
  reason?: string;
  selected: boolean;
}

/** Danh sách chủ đề đề xuất: chọn / sửa / bỏ / thêm (useFieldArray) – dùng IdeaCard. */
export function IdeaListField({ name, label, addLabel = 'Thêm chủ đề' }: IdeaListFieldProps) {
  const { control, getValues, setValue } = useFormContext();
  const { readOnly } = useFieldMeta(name);
  const { fields, append, remove, update } = useFieldArray({ control, name });
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const rowAt = (index: number) => getValues(`${name}.${String(index)}`) as IdeaRow;

  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <h3 className="text-label text-ink">{label}</h3>
      {fields.map((row, index) => {
        const idea = rowAt(index);
        if (editing === index) {
          return (
            <div key={row.id} className="flex flex-col gap-2 rounded-lg border border-line bg-surface-0 p-4">
              <Field label="Tên chủ đề">
                {(c) => (
                  <input
                    {...c}
                    type="text"
                    value={editText}
                    onChange={(e) => {
                      setEditText(e.target.value);
                    }}
                  />
                )}
              </Field>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    if (editText.trim() !== '') update(index, { ...idea, title: editText.trim() });
                    setEditing(null);
                  }}
                >
                  Lưu
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(null);
                  }}
                >
                  Hủy
                </Button>
              </div>
            </div>
          );
        }
        return (
          <IdeaCard
            key={row.id}
            idea={{ id: idea.id, title: idea.title, ...(idea.reason !== undefined ? { reason: idea.reason } : {}) }}
            selected={idea.selected}
            {...(readOnly
              ? {}
              : {
                  onSelect: () => {
                    setValue(`${name}.${String(index)}.selected`, !idea.selected, { shouldDirty: true });
                  },
                  onEdit: () => {
                    setEditing(index);
                    setEditText(idea.title);
                  },
                  onRemove: () => {
                    remove(index);
                  },
                })}
          />
        );
      })}
      {!readOnly && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Chủ đề mới">
              {(c) => (
                <input
                  {...c}
                  type="text"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (draft.trim() !== '') {
                        append({ id: `n${String(Date.now())}`, title: draft.trim(), selected: true });
                        setDraft('');
                      }
                    }
                  }}
                />
              )}
            </Field>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              if (draft.trim() === '') return;
              append({ id: `n${String(Date.now())}`, title: draft.trim(), selected: true });
              setDraft('');
            }}
          >
            {addLabel}
          </Button>
        </div>
      )}
    </section>
  );
}
