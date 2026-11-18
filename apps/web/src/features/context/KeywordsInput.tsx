import { PROFILE_LIMITS } from '@app/shared/context';
import { useId, useState } from 'react';
import { Button } from '../../ui/button/Button';
import { Icon } from '../../ui/icons/Icon';

// Ô từ khóa (006 contracts/business-profile-ui.md): Enter (hoặc nút "Thêm") để thêm, mỗi thẻ có nút xóa
// nhãn "Xóa từ khóa X", tối đa 20, vùng chạm ≥ 44 × 44 px. Kiểm trùng/độ dài do lược đồ dùng chung.
// Giá trị là điều khoản của trang (không qua react-hook-form) nên chưa dùng `TagListField` – xem plan.md (T074).

export interface KeywordsInputProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  readOnly?: boolean;
  /** Lỗi theo ô: khóa "keywords" hoặc "keywords.<i>". */
  errors: Record<string, string>;
  inputId?: string;
}

const CHIP = 'inline-flex items-center rounded-pill border border-line-strong text-body-sm';

export function KeywordsInput({
  label,
  value,
  onChange,
  readOnly = false,
  errors,
  inputId,
}: KeywordsInputProps) {
  const autoId = useId();
  const id = inputId ?? autoId;
  const [draft, setDraft] = useState('');
  const full = value.length >= PROFILE_LIMITS.keywordsMax;
  const listError = errors.keywords;
  const itemErrors = value
    .map((_, i) => errors[`keywords.${String(i)}`])
    .filter((e): e is string => e !== undefined);
  const allErrors = [...(listError !== undefined ? [listError] : []), ...itemErrors];

  const add = () => {
    const k = draft.trim();
    if (k === '' || full) return;
    onChange([...value, k]);
    setDraft('');
  };

  if (readOnly) {
    return (
      <div className="flex flex-col gap-1">
        <span id={`${id}-label`} className="text-label text-ink">
          {label}
        </span>
        {value.length === 0 ? (
          <p className="text-ink-muted">Chưa có từ khóa.</p>
        ) : (
          <ul aria-labelledby={`${id}-label`} className="flex flex-wrap gap-2">
            {value.map((k, i) => (
              <li key={`${k}-${String(i)}`} className={`${CHIP} px-3 py-1`}>
                {k}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-label text-ink">
        {label}
      </label>
      {value.length > 0 && (
        <ul aria-label="Từ khóa đã thêm" className="flex flex-wrap gap-2">
          {value.map((k, i) => (
            <li key={`${k}-${String(i)}`} className={`${CHIP} gap-1 pl-3`}>
              <span>{k}</span>
              <button
                type="button"
                aria-label={`Xóa từ khóa ${k}`}
                className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-pill focus-visible:ring-2 focus-visible:ring-brand"
                onClick={() => {
                  onChange(value.filter((_, j) => j !== i));
                }}
              >
                <Icon name="x" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          className="min-h-touch w-full min-w-0 flex-1 rounded-md border border-line-strong bg-surface-0 px-3 py-2 text-body text-ink focus-visible:ring-2 focus-visible:ring-brand"
          value={draft}
          disabled={full}
          placeholder={full ? undefined : 'vd: áo dài, may đo'}
          aria-invalid={allErrors.length > 0}
          aria-describedby={`${id}-hint${allErrors.length > 0 ? ` ${id}-err` : ''}`}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" onClick={add} locked={full}>
          Thêm
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-caption text-ink-muted">
        {full
          ? `Đã đủ ${String(PROFILE_LIMITS.keywordsMax)} từ khóa.`
          : `Nhấn Enter để thêm. ${String(value.length)}/${String(PROFILE_LIMITS.keywordsMax)} từ khóa.`}
      </p>
      {allErrors.length > 0 && (
        <div id={`${id}-err`} className="flex flex-col gap-1">
          {allErrors.map((e) => (
            <p key={e} className="flex items-start gap-1 text-body-sm text-danger">
              <Icon name="alert" className="mt-1 size-4" />
              <span>{e}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
