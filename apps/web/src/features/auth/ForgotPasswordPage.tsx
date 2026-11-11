import { useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { AuthLayout } from './AuthLayout';
import { authApi } from './auth-api';
import { ErrorNotice, InfoNotice, styles, TextField } from './ui';

// Quên mật khẩu (US5, FR-009): thông điệp LUÔN như nhau dù email có tài khoản hay không.

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(undefined);
    try {
      await authApi.forgot(email);
      setSent(true);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      const field = err.fieldErrors().email;
      if (field !== undefined) setFieldError(field);
      else setError(err);
    }
  }

  return (
    <AuthLayout title="Quên mật khẩu">
      {sent ? (
        <InfoNotice>
          Nếu email có tài khoản, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu. Liên kết có hiệu lực
          30 phút.
        </InfoNotice>
      ) : (
        <>
          <p>Nhập email bạn dùng để đăng nhập. Chúng tôi sẽ gửi liên kết đặt lại mật khẩu.</p>
          {error !== null && <ErrorNotice error={error} />}
          <form onSubmit={(e) => void submit(e)} noValidate>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              error={fieldError}
            />
            <button type="submit" style={styles.primary}>
              Gửi liên kết
            </button>
          </form>
        </>
      )}
      <p>
        <Link to="/login" style={styles.link}>
          Quay lại đăng nhập
        </Link>
      </p>
    </AuthLayout>
  );
}
