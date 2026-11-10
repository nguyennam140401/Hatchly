import { useId, useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { AuthLayout } from './AuthLayout';
import { authApi } from './auth-api';
import { PasswordField } from './PasswordField';
import { ErrorNotice, InfoNotice, styles, TextField } from './ui';

// Đăng ký (US1, FR-001…FR-005): ô đồng ý điều khoản KHÔNG đặt sẵn (nguyên tắc VII). Phản hồi luôn là
// "Hãy kiểm tra email" – kể cả khi email đã có tài khoản (không lộ email nào đã đăng ký).

/** Phiên bản điều khoản người dùng đang xem (máy chủ ghi phiên bản hiện hành của nó). */
export const TERMS_VERSION = '2026-11';

export function RegisterPage() {
  const termsId = useId();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (displayName.trim() === '') local.displayName = 'Vui lòng nhập tên hiển thị.';
    if (email.trim() === '') local.email = 'Vui lòng nhập email.';
    if (password.length < 8) local.password = 'Mật khẩu cần ít nhất 8 ký tự.';
    if (!accepted) local.acceptTerms = 'Bạn cần đồng ý điều khoản để tạo tài khoản.';
    setFieldErrors(local);
    setError(null);
    if (Object.keys(local).length > 0) return;
    setBusy(true);
    try {
      await authApi.register({
        displayName,
        email,
        password,
        acceptTerms: true,
        termsVersion: TERMS_VERSION,
      });
      setSentTo(email.trim());
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setFieldErrors(err.fieldErrors());
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (sentTo !== null) {
    return (
      <AuthLayout title="Hãy kiểm tra email">
        <InfoNotice>
          Chúng tôi đã gửi thư tới <strong>{sentTo}</strong>. Mở thư và bấm liên kết để xác nhận
          email rồi bắt đầu dùng ứng dụng. Liên kết có hiệu lực 24 giờ.
        </InfoNotice>
        {resent && <p role="status">Đã gửi lại thư (nếu chưa thấy, hãy xem cả mục Thư rác).</p>}
        <button
          type="button"
          style={styles.secondary}
          onClick={() => {
            void authApi.resend(sentTo).then(() => {
              setResent(true);
            });
          }}
        >
          Gửi lại thư
        </button>
        <p>
          <Link to="/login" style={styles.link}>
            Đã xác nhận? Đăng nhập
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Tạo tài khoản">
      {error !== null && Object.keys(fieldErrors).length === 0 && <ErrorNotice error={error} />}
      <form onSubmit={(e) => void submit(e)} noValidate>
        <TextField
          label="Tên hiển thị"
          value={displayName}
          onChange={setDisplayName}
          autoComplete="name"
          error={fieldErrors.displayName}
        />
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          error={fieldErrors.email}
        />
        <PasswordField
          label="Mật khẩu"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint="Ít nhất 8 ký tự. Tránh mật khẩu dễ đoán như 12345678."
          error={fieldErrors.password}
        />
        <div style={{ ...styles.field, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <input
            id={termsId}
            type="checkbox"
            checked={accepted}
            onChange={(e) => {
              setAccepted(e.target.checked);
            }}
            style={{ width: 24, height: 24, margin: 10 }}
            aria-invalid={fieldErrors.acceptTerms !== undefined}
            {...(fieldErrors.acceptTerms !== undefined
              ? { 'aria-describedby': `${termsId}-err` }
              : {})}
          />
          <div>
            <label htmlFor={termsId}>
              Tôi đồng ý với Điều khoản sử dụng và Chính sách bảo vệ dữ liệu cá nhân
            </label>
            {fieldErrors.acceptTerms !== undefined && (
              <p id={`${termsId}-err`} style={styles.error}>
                <span aria-hidden="true">⚠ </span>
                {fieldErrors.acceptTerms}
              </p>
            )}
          </div>
        </div>
        <button type="submit" style={styles.primary} disabled={busy}>
          {busy ? 'Đang tạo…' : 'Tạo tài khoản'}
        </button>
      </form>
      <p>
        <Link to="/login" style={styles.link}>
          Đã có tài khoản? Đăng nhập
        </Link>
      </p>
    </AuthLayout>
  );
}
