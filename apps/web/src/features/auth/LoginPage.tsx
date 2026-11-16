import { useNavigate, useSearchParams } from 'react-router';
import { authApi, safeNext } from '../../lib/api/endpoints/auth';
import { objectSchema } from '../../lib/forms/rules';
import { useAppForm } from '../../lib/forms/useAppForm';
import { Form } from '../../ui/form/Form';
import { TextField } from '../../ui/form/fields/inputs';
import { TextLink } from '../../ui/nav/TextLink';
import { AuthLayout } from './AuthLayout';
import { PasswordField } from './PasswordField';
import { ProviderButtons } from './ProviderButtons';

// Đăng nhập (US2, FR-006, FR-007). Thành công → quay về `next` NỘI BỘ hợp lệ hoặc "/"; email chưa
// xác nhận → /verify-email. Sai thông tin/bị chặn/không dùng được: thông điệp của máy chủ + hành động.

export interface LoginValues extends Record<string, unknown> {
  email: string;
  password: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const form = useAppForm<LoginValues>({
    schema: objectSchema<LoginValues>({}),
    defaultValues: { email: '', password: '' },
    onSubmit: async (values) => {
      try {
        const me = await authApi.login(values);
        void navigate(me.user.emailVerified ? safeNext(params.get('next')) : '/verify-email', {
          replace: true,
        });
      } catch (err) {
        form.methods.setValue('password', ''); // không giữ mật khẩu sau khi bị từ chối
        throw err;
      }
    },
  });

  return (
    <AuthLayout title="Đăng nhập">
      <Form
        form={form}
        submitLabel="Đăng nhập"
        errorActions={(error) =>
          error.code === 'LOGIN_THROTTLED' || error.code === 'INVALID_CREDENTIALS'
            ? [{ kind: 'navigate', label: 'Quên mật khẩu', href: '/forgot-password' }]
            : error.actions
        }
      >
        <TextField name="email" label="Email" type="email" autoComplete="email" />
        <PasswordField name="password" label="Mật khẩu" autoComplete="current-password" />
      </Form>
      {/* 009: đăng nhập bằng Google/Facebook (không có ở lối vào nhân viên nội bộ). */}
      <p className="text-center text-ink-muted">hoặc</p>
      <ProviderButtons />
      <p className="flex flex-wrap gap-4">
        <TextLink to="/forgot-password">Quên mật khẩu?</TextLink>
        <TextLink to="/register">Tạo tài khoản</TextLink>
      </p>
    </AuthLayout>
  );
}
