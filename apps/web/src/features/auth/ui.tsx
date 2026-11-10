import { useId, type CSSProperties, type ReactNode } from 'react';
import type { ApiError } from '../../lib/api-client';

// Khối giao diện dùng chung của các trang xác thực (nguyên tắc VI): tiếng Việt đời thường, vùng chạm
// ≥ 44 × 44 px, chạy từ 360 px, lỗi đọc được qua aria-describedby, trạng thái có chữ + biểu tượng.

export const styles = {
  page: {
    boxSizing: 'border-box',
    maxWidth: 440,
    minWidth: 0,
    margin: '0 auto',
    padding: 16,
    fontFamily: 'system-ui, sans-serif',
    lineHeight: 1.5,
    color: '#1a1a1a',
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 },
  input: {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: 44,
    padding: '8px 12px',
    fontSize: 16,
    border: '1px solid #6b7280',
    borderRadius: 8,
  },
  primary: {
    minWidth: 44,
    minHeight: 44,
    width: '100%',
    padding: '10px 16px',
    fontSize: 16,
    borderRadius: 8,
    border: '1px solid #1d4ed8',
    background: '#1d4ed8',
    color: '#fff',
    cursor: 'pointer',
  },
  secondary: {
    minWidth: 44,
    minHeight: 44,
    padding: '10px 16px',
    fontSize: 16,
    borderRadius: 8,
    border: '1px solid #1d4ed8',
    background: '#fff',
    color: '#1d4ed8',
    cursor: 'pointer',
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 44,
    color: '#1d4ed8',
  },
  error: { color: '#b91c1c', fontSize: 14, margin: 0 },
} satisfies Record<string, CSSProperties>;

export interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  type?: 'text' | 'email';
  autoComplete: string;
  hint?: string;
}

export function TextField({
  label,
  value,
  onChange,
  error,
  type = 'text',
  autoComplete,
  hint,
}: FieldProps) {
  const id = useId();
  const describedBy = [
    hint !== undefined ? `${id}-hint` : '',
    error !== undefined ? `${id}-err` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div style={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        style={styles.input}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        aria-invalid={error !== undefined}
        {...(describedBy !== '' ? { 'aria-describedby': describedBy } : {})}
      />
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

export const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

/**
 * Hộp lỗi: lời giải thích + ít nhất một hành động (nguyên tắc VI); mã gốc chỉ ở "Chi tiết cho hỗ trợ".
 * `actions` của trang thay cho hành động mặc định của máy chủ khi cần (vd nút gửi lại thư).
 */
export function ErrorNotice({ error, children }: { error: ApiError; children?: ReactNode }) {
  const actions = error.body?.actions ?? [];
  return (
    <div
      role="alert"
      style={{ border: '1px solid #b91c1c', borderRadius: 8, padding: 12, marginBottom: 16 }}
    >
      <p style={{ margin: '0 0 8px' }}>
        <span role="img" aria-label="Lỗi">
          ⚠
        </span>{' '}
        {error.message}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {children}
        {children === undefined &&
          actions
            .filter((a) => a.kind === 'navigate' && a.href !== undefined)
            .map((a) => (
              <a key={a.label} href={a.href} style={styles.link}>
                {a.label}
              </a>
            ))}
      </div>
      {error.body !== null && (
        <details style={{ marginTop: 8, fontSize: 14, color: '#4b5563' }}>
          <summary
            style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
          >
            Chi tiết cho hỗ trợ
          </summary>
          <p style={{ margin: 0 }}>
            Mã theo dõi: {error.body.support.traceId}
            {error.body.support.detail !== undefined
              ? ` · ${error.code} · ${error.body.support.detail}`
              : ` · ${error.code}`}
          </p>
        </details>
      )}
    </div>
  );
}

/** Thông báo thành công/thông tin (chữ + biểu tượng có nhãn). */
export function InfoNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      style={{ border: '1px solid #15803d', borderRadius: 8, padding: 12, marginBottom: 16 }}
    >
      <span role="img" aria-label="Thông tin">
        ✉
      </span>{' '}
      {children}
    </div>
  );
}
