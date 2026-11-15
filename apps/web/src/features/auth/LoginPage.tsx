import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { AuthLayout } from './AuthLayout';
import { authApi, safeNext } from './auth-api';
import { PasswordField } from './PasswordField';
import { ProviderButtons } from './ProviderButtons';
import { ErrorNotice, styles, TextField } from './ui';

// Đăng nhập (US2, FR-006, FR-007). Thành công → quay về `next` NỘI BỘ hợp lệ hoặc "/"; email chưa
// xác nhận → /verify-email. Sai thông tin/bị chặn/không dùng được: thông điệp của máy chủ + hành động.

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const me = await authApi.login({ email, password });
      void navigate(me.user.emailVerified ? safeNext(params.get('next')) : '/verify-email', {
        replace: true,
      });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Đăng nhập">
      {error !== null && (
        <ErrorNotice error={error}>
          {error.code === 'LOGIN_THROTTLED' || error.code === 'INVALID_CREDENTIALS' ? (
            <Link to="/forgot-password" style={styles.link}>
              Quên mật khẩu
            </Link>
          ) : undefined}
        </ErrorNotice>
      )}
      <form onSubmit={(e) => void submit(e)} noValidate>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <PasswordField
          label="Mật khẩu"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <button type="submit" style={styles.primary} disabled={busy}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
      {/* 009: đăng nhập bằng Google/Facebook (không có ở lối vào nhân viên nội bộ). */}
      <p style={{ textAlign: 'center', color: '#4b5563' }}>hoặc</p>
      <ProviderButtons />
      <p style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <Link to="/forgot-password" style={styles.link}>
          Quên mật khẩu?
        </Link>
        <Link to="/register" style={styles.link}>
          Tạo tài khoản
        </Link>
      </p>
    </AuthLayout>
  );
}
