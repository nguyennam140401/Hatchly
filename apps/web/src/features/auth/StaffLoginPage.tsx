import type { StaffMeResponse } from '@app/shared/auth';
import { useState, type SyntheticEvent } from 'react';
import { ApiError } from '../../lib/api-client';
import { AuthLayout } from './AuthLayout';
import { authApi } from './auth-api';
import { PasswordField } from './PasswordField';
import { ErrorNotice, InfoNotice, styles, TextField } from './ui';

const STAFF_ROLE_LABEL: Record<StaffMeResponse['role'], string> = {
  admin: 'Quản trị',
  support: 'Hỗ trợ',
};

// Lối vào nội bộ (US4, FR-010, FR-016): tách khỏi đăng nhập của khách hàng; phiên ngắn. Màn hình tra
// cứu hỗ trợ làm ở tính năng sau – ở đây chỉ báo đã đăng nhập.

export function StaffLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [staff, setStaff] = useState<StaffMeResponse | null>(null);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setError(null);
    try {
      setStaff(await authApi.staffLogin({ email, password }));
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err);
      setPassword('');
    }
  }

  return (
    <AuthLayout title="Đăng nhập nội bộ">
      {staff !== null ? (
        <InfoNotice>
          {`Đã đăng nhập: ${staff.staff.displayName} (${STAFF_ROLE_LABEL[staff.role]}).`}{' '}
          Phiên tự hết sau 30 phút không dùng.
        </InfoNotice>
      ) : (
        <>
          <p>Dành cho nhân viên hỗ trợ và quản trị. Khách hàng đăng nhập ở trang chính.</p>
          {error !== null && <ErrorNotice error={error} />}
          <form onSubmit={(e) => void submit(e)} noValidate>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="username"
            />
            <PasswordField
              label="Mật khẩu"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
            <button type="submit" style={styles.primary}>
              Đăng nhập
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
