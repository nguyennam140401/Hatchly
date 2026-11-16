import { useState } from 'react';
import { useNavigate } from 'react-router';
import { authApi, takeFragmentToken } from '../../lib/api/endpoints/auth';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { objectSchema } from '../../lib/forms/rules';
import { useAppForm } from '../../lib/forms/useAppForm';
import { Form } from '../../ui/form/Form';
import { TextLink } from '../../ui/nav/TextLink';
import { AuthLayout } from './AuthLayout';
import { PasswordField } from '../../ui/form/fields/PasswordField';

// Đặt lại mật khẩu (US5, FR-009): mã `#token=` được đọc và XÓA khỏi thanh địa chỉ ngay khi mở trang
// (trước mọi lời gọi API); mã chỉ nằm trong bộ nhớ của trang.

export interface ResetValues extends Record<string, unknown> {
  newPassword: string;
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  // Đọc một lần khi dựng trang (lazy initializer) – thanh địa chỉ không còn mã.
  const [token] = useState<string | null>(() => takeFragmentToken());
  const form = useAppForm<ResetValues>({
    schema: objectSchema<ResetValues>({}),
    defaultValues: { newPassword: '' },
    onSubmit: async (values) => {
      if (token === null) return;
      await authApi.reset(token, values.newPassword);
      void navigate('/', { replace: true });
    },
  });

  const error = form.submitError;
  const invalid = token === null || error?.code === 'TOKEN_INVALID';

  return (
    <AuthLayout title="Đặt mật khẩu mới">
      {invalid ? (
        error !== null ? (
          <ErrorNotice
            error={error}
            actions={[{ kind: 'navigate', label: 'Gửi lại liên kết', href: '/forgot-password' }]}
          />
        ) : (
          <>
            <p>Liên kết không đầy đủ. Hãy mở lại liên kết trong thư, hoặc yêu cầu liên kết mới.</p>
            <TextLink to="/forgot-password">Gửi lại liên kết</TextLink>
          </>
        )
      ) : (
        <Form form={form} submitLabel="Lưu mật khẩu mới">
          <PasswordField
            name="newPassword"
            label="Mật khẩu mới"
            autoComplete="new-password"
            help="Ít nhất 8 ký tự. Sau khi đổi, mọi thiết bị khác sẽ bị đăng xuất."
          />
        </Form>
      )}
    </AuthLayout>
  );
}
