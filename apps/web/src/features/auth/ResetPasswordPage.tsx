import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { AuthLayout } from './AuthLayout';
import { authApi, takeFragmentToken } from './auth-api';
import { PasswordField } from './PasswordField';
import { ErrorNotice, styles } from './ui';

// Đặt lại mật khẩu (US5, FR-009): mã `#token=` được đọc và XÓA khỏi thanh địa chỉ ngay khi mở trang
// (trước mọi lời gọi API); mã chỉ nằm trong bộ nhớ của trang.

export function ResetPasswordPage() {
  const navigate = useNavigate();
  // Đọc một lần khi dựng trang (lazy initializer) – thanh địa chỉ không còn mã.
  const [token] = useState<string | null>(() => takeFragmentToken());
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    if (token === null) return;
    setError(null);
    setFieldError(undefined);
    try {
      await authApi.reset(token, password);
      void navigate('/', { replace: true });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      const field = err.fieldErrors().newPassword;
      if (field !== undefined) setFieldError(field);
      else setError(err);
    }
  }

  const invalid = token === null || error?.code === 'TOKEN_INVALID';

  return (
    <AuthLayout title="Đặt mật khẩu mới">
      {invalid ? (
        <>
          {error !== null ? (
            <ErrorNotice error={error}>
              <Link to="/forgot-password" style={styles.link}>
                Gửi lại liên kết
              </Link>
            </ErrorNotice>
          ) : (
            <p>Liên kết không đầy đủ. Hãy mở lại liên kết trong thư, hoặc yêu cầu liên kết mới.</p>
          )}
          {error === null && (
            <Link to="/forgot-password" style={styles.link}>
              Gửi lại liên kết
            </Link>
          )}
        </>
      ) : (
        <>
          {error !== null && <ErrorNotice error={error} />}
          <form onSubmit={(e) => void submit(e)} noValidate>
            <PasswordField
              label="Mật khẩu mới"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              hint="Ít nhất 8 ký tự. Sau khi đổi, mọi thiết bị khác sẽ bị đăng xuất."
              error={fieldError}
            />
            <button type="submit" style={styles.primary}>
              Lưu mật khẩu mới
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
