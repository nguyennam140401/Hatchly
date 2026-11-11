import type { MeResponse } from '@app/shared/auth';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { AuthLayout } from './AuthLayout';
import { authApi, takeFragmentToken } from './auth-api';
import { ErrorNotice, InfoNotice, styles, TextField } from './ui';

// Xác nhận email (US1, FR-008, FR-008a): mã nằm sau `#token=` (không gửi lên máy chủ web, không vào
// nhật ký truy cập) và được XÓA khỏi thanh địa chỉ trước khi gọi API. Không có mã mà đang đăng nhập
// chưa xác nhận → màn hình "Hãy xác nhận email" (gửi lại thư, sửa email, đăng xuất).

type State =
  | { kind: 'checking' }
  | { kind: 'verifying' }
  | { kind: 'invalid'; error: ApiError }
  | { kind: 'pending'; me: MeResponse }
  | { kind: 'anonymous' };

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [notice, setNotice] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode gọi hiệu ứng hai lần – mã chỉ dùng được một lần.
    started.current = true;
    const token = takeFragmentToken();
    if (token !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- bắt đầu xác nhận ngay khi mở liên kết
      setState({ kind: 'verifying' });
      authApi.verifyEmail(token).then(
        () => void navigate('/', { replace: true }),
        (err: unknown) => {
          if (err instanceof ApiError) setState({ kind: 'invalid', error: err });
        },
      );
      return;
    }
    authApi.me({ silentAuth: true }).then(
      (me) => {
        if (me.user.emailVerified) void navigate('/', { replace: true });
        else setState({ kind: 'pending', me });
      },
      () => {
        setState({ kind: 'anonymous' });
      },
    );
  }, [navigate]);

  const resend = (email?: string) =>
    authApi.resend(email).then(() => {
      setNotice('Đã gửi lại thư xác nhận. Nếu chưa thấy, hãy xem cả mục Thư rác.');
    });

  async function changeEmail(e: SyntheticEvent) {
    e.preventDefault();
    setEmailError(undefined);
    try {
      await authApi.changeEmail(newEmail);
      setNotice(`Đã gửi thư xác nhận tới ${newEmail.trim()}. Hãy mở thư mới để xác nhận.`);
      setNewEmail('');
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setEmailError(err.fieldErrors().email ?? err.message);
    }
  }

  switch (state.kind) {
    case 'checking':
    case 'verifying':
      return (
        <AuthLayout title="Xác nhận email">
          <p aria-busy="true">
            {state.kind === 'verifying' ? 'Đang xác nhận email…' : 'Đang tải…'}
          </p>
        </AuthLayout>
      );
    case 'invalid':
      return (
        <AuthLayout title="Liên kết không dùng được">
          <ErrorNotice error={state.error}>
            <a href="/login" style={styles.link}>
              Đăng nhập để gửi lại thư
            </a>
          </ErrorNotice>
        </AuthLayout>
      );
    case 'anonymous':
      return (
        <AuthLayout title="Xác nhận email">
          <p>Hãy mở liên kết trong thư xác nhận, hoặc đăng nhập để gửi lại thư.</p>
          <a href="/login" style={styles.link}>
            Đăng nhập
          </a>
        </AuthLayout>
      );
    case 'pending':
      return (
        <AuthLayout title="Hãy xác nhận email">
          <p>
            Chúng tôi đã gửi thư tới <strong>{state.me.user.email}</strong>. Bấm liên kết trong thư
            để tiếp tục.
          </p>
          {notice !== null && <InfoNotice>{notice}</InfoNotice>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            <button type="button" style={styles.secondary} onClick={() => void resend()}>
              Gửi lại thư
            </button>
            <button
              type="button"
              style={styles.secondary}
              onClick={() => {
                void authApi.logout().finally(() => void navigate('/login', { replace: true }));
              }}
            >
              Đăng xuất
            </button>
          </div>
          <form onSubmit={(e) => void changeEmail(e)} noValidate>
            <h2 style={{ fontSize: 18 }}>Sửa email đăng ký</h2>
            <TextField
              label="Email mới"
              type="email"
              value={newEmail}
              onChange={setNewEmail}
              autoComplete="email"
              error={emailError}
            />
            <button type="submit" style={styles.primary}>
              Lưu và gửi thư mới
            </button>
          </form>
        </AuthLayout>
      );
  }
}
