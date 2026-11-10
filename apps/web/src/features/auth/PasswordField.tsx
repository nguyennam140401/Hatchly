import { useId, useState } from 'react';
import { styles, visuallyHidden, type FieldProps } from './ui';

/** Ô mật khẩu có nút hiện/ẩn (aria-pressed); `autoComplete` do trang truyền (current/new-password). */
export function PasswordField({
  label,
  value,
  onChange,
  error,
  autoComplete,
  hint,
}: Omit<FieldProps, 'type'> & { autoComplete: 'current-password' | 'new-password' }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const describedBy = [
    hint !== undefined ? `${id}-hint` : '',
    error !== undefined ? `${id}-err` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div style={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          style={{ ...styles.input, flex: 1, minWidth: 0 }}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          aria-invalid={error !== undefined}
          {...(describedBy !== '' ? { 'aria-describedby': describedBy } : {})}
        />
        <button
          type="button"
          style={styles.secondary}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => {
            setVisible((v) => !v);
          }}
        >
          {visible ? 'Ẩn' : 'Hiện'}
          <span style={visuallyHidden}> mật khẩu</span>
        </button>
      </div>
      {hint !== undefined && (
        <p id={`${id}-hint`} style={{ margin: 0, fontSize: 14, color: '#4b5563' }}>
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-err`} style={styles.error}>
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
    </div>
  );
}
