import { useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { AuthLayout } from './AuthLayout';
import { authApi } from './auth-api';
import { TermsCheckbox } from './ConsentNotice';
import { PasswordField } from './PasswordField';
import { ProviderButtons } from './ProviderButtons';
import { ErrorNotice, InfoNotice, styles, TextField } from './ui';

// Đăng ký (US1, FR-001…FR-005): ô đồng ý điều khoản KHÔNG đặt sẵn (nguyên tắc VII). Phản hồi luôn là
// "Hãy kiểm tra email" – kể cả khi email đã có tài khoản (không lộ email nào đã đăng ký).

/** Phiên bản điều khoản người dùng đang xem (máy chủ ghi phiên bản hiện hành của nó). */
export const TERMS_VERSION = '2026-11';

export function RegisterPage() {
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
        <TermsCheckbox checked={accepted} onChange={setAccepted} error={fieldErrors.acceptTerms} />
        <button type="submit" style={styles.primary} disabled={busy}>
          {busy ? 'Đang tạo…' : 'Tạo tài khoản'}
        </button>
      </form>
      {/* 009: đăng ký bằng Google/Facebook – điều khoản được hỏi lại ở bước hoàn tất sau khi quay về. */}
      <p style={{ textAlign: 'center', color: '#4b5563' }}>hoặc</p>
      <ProviderButtons />
      <p>
        <Link to="/login" style={styles.link}>
          Đã có tài khoản? Đăng nhập
        </Link>
      </p>
    </AuthLayout>
  );
}
