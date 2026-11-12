import { PROFILE_LIMITS } from '@app/shared/context';
import { useId, useState } from 'react';
import { styles } from '../auth/ui';

// Ô từ khóa (006 contracts/business-profile-ui.md): Enter (hoặc nút "Thêm") để thêm, mỗi thẻ có nút xóa
// nhãn "Xóa từ khóa X", tối đa 20, vùng chạm ≥ 44 × 44 px. Kiểm trùng/độ dài do lược đồ dùng chung.

export interface KeywordsInputProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  readOnly?: boolean;
  /** Lỗi theo ô: khóa "keywords" hoặc "keywords.<i>". */
  errors: Record<string, string>;
  inputId?: string;
}

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
    .map((_, i) => errors[`keywords.${i}`])
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
      <div style={styles.field}>
        <span id={`${id}-label`}>{label}</span>
        {value.length === 0 ? (
          <p style={{ margin: 0, color: '#4b5563' }}>Chưa có từ khóa.</p>
        ) : (
          <ul
            aria-labelledby={`${id}-label`}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              listStyle: 'none',
              padding: 0,
              margin: 0,
            }}
          >
            {value.map((k, i) => (
              <li
                key={`${k}-${i}`}
                style={{ border: '1px solid #6b7280', borderRadius: 16, padding: '4px 12px' }}
              >
                {k}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div style={styles.field}>
      <label htmlFor={id}>{label}</label>
      {value.length > 0 && (
        <ul
          aria-label="Từ khóa đã thêm"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            listStyle: 'none',
            padding: 0,
            margin: 0,
          }}
        >
          {value.map((k, i) => (
            <li
              key={`${k}-${i}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                border: '1px solid #6b7280',
                borderRadius: 16,
                paddingLeft: 12,
              }}
            >
              <span>{k}</span>
              <button
                type="button"
                aria-label={`Xóa từ khóa ${k}`}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 18,
                }}
                onClick={() => {
                  onChange(value.filter((_, j) => j !== i));
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id={id}
          type="text"
          style={{ ...styles.input, flex: 1, minWidth: 0 }}
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
        <button type="button" style={styles.secondary} onClick={add} disabled={full}>
          Thêm
        </button>
      </div>
      <p id={`${id}-hint`} style={{ margin: 0, fontSize: 14, color: '#4b5563' }}>
        {full
          ? `Đã đủ ${PROFILE_LIMITS.keywordsMax} từ khóa.`
          : `Nhấn Enter để thêm. ${value.length}/${PROFILE_LIMITS.keywordsMax} từ khóa.`}
      </p>
      {allErrors.length > 0 && (
        <div id={`${id}-err`}>
          {allErrors.map((e) => (
            <p key={e} style={styles.error}>
              <span aria-hidden="true">⚠ </span>
              {e}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
