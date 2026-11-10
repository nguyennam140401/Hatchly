import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { AuthLayout } from './AuthLayout';
import { authApi } from './auth-api';
import { PasswordField } from './PasswordField';
import { useSession } from './session';
import { ErrorNotice, InfoNotice, styles } from './ui';

// Bảo mật (US2, US5): đăng xuất, đăng xuất mọi thiết bị (có hộp xác nhận), đổi mật khẩu.

export function SecuritySettingsPage() {
  const navigate = useNavigate();
  const { me } = useSession();
  const [confirmAll, setConfirmAll] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);

  const logout = (all: boolean) =>
    (all ? authApi.logoutAll() : authApi.logout()).finally(
      () => void navigate('/login', { replace: true }),
    );

  async function changePassword(e: SyntheticEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    setFieldErrors({});
    try {
      await authApi.change(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      const fields = err.fieldErrors();
      setFieldErrors(fields);
      if (Object.keys(fields).length === 0) setError(err);
    }
  }

  return (
    <AuthLayout title="Bảo mật tài khoản">
      <p>
        Đang đăng nhập: <strong>{me.user.email}</strong>
      </p>

      <section aria-labelledby="change-password">
        <h2 id="change-password" style={{ fontSize: 18 }}>
          Đổi mật khẩu
        </h2>
        {done && <InfoNotice>Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.</InfoNotice>}
        {error !== null && <ErrorNotice error={error} />}
        <form onSubmit={(e) => void changePassword(e)} noValidate>
          <PasswordField
            label="Mật khẩu hiện tại"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
            error={fieldErrors.currentPassword}
          />
          <PasswordField
            label="Mật khẩu mới"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            hint="Ít nhất 8 ký tự, không trùng email."
            error={fieldErrors.newPassword}
          />
          <button type="submit" style={styles.primary}>
            Đổi mật khẩu
          </button>
        </form>
      </section>

      <section aria-labelledby="sessions" style={{ marginTop: 32 }}>
        <h2 id="sessions" style={{ fontSize: 18 }}>
          Phiên đăng nhập
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" style={styles.secondary} onClick={() => void logout(false)}>
            Đăng xuất
          </button>
          <button
            type="button"
            style={styles.secondary}
            onClick={() => {
              setConfirmAll(true);
            }}
          >
            Đăng xuất khỏi mọi thiết bị
          </button>
        </div>
        {confirmAll && (
          <div
            role="alertdialog"
            aria-modal="false"
            aria-labelledby="confirm-all-title"
            style={{ border: '1px solid #b45309', borderRadius: 8, padding: 12, marginTop: 16 }}
          >
            <p id="confirm-all-title" style={{ marginTop: 0 }}>
              Đăng xuất khỏi mọi thiết bị, kể cả thiết bị này?
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" style={styles.primary} onClick={() => void logout(true)}>
                Đăng xuất tất cả
              </button>
              <button
                type="button"
                style={styles.secondary}
                onClick={() => {
                  setConfirmAll(false);
                }}
              >
                Hủy
              </button>
            </div>
          </div>
        )}
      </section>

      <p style={{ marginTop: 32 }}>
        <Link to="/" style={styles.link}>
          Về trang chính
        </Link>
      </p>
    </AuthLayout>
  );
}
