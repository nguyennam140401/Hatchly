import { useNavigate, useSearchParams } from 'react-router';
import { authApi, safeNext } from '../../lib/api/endpoints/auth';
import { AppError } from '../../lib/api/errors';
import { objectSchema, required } from '../../lib/forms/rules';
import { useAppForm, type FormComponentProps } from '../../lib/forms/useAppForm';
import { Form } from '../../ui/form/Form';
import { PasswordField } from '../../ui/form/fields/PasswordField';
import { TextField } from '../../ui/form/fields/inputs';
import { TextLink } from '../../ui/nav/TextLink';
import { AuthLayout } from './AuthLayout';
import { ProviderButtons } from './ProviderButtons';

// Đăng nhập (US2, FR-006, FR-007). Thành công → quay về `next` NỘI BỘ hợp lệ hoặc "/"; email chưa
// xác nhận → /verify-email. Sai thông tin/bị chặn/không dùng được: thông điệp của máy chủ + hành động.

export interface LoginValues extends Record<string, unknown> {
  email: string;
  password: string;
}

/** Mã lỗi nghĩa là thông tin đăng nhập bị từ chối (khác lỗi hệ thống). */
const CREDENTIAL_ERRORS: ReadonlySet<string> = new Set(['INVALID_CREDENTIALS', 'LOGIN_THROTTLED']);

const loginSchema = objectSchema<LoginValues>({
  email: required('Vui lòng nhập email.'),
  password: required('Vui lòng nhập mật khẩu.'),
});

/** Biểu mẫu đăng nhập (tách riêng để dùng lại và kiểm thử theo hợp đồng biểu mẫu – SC-007). */
export function LoginForm({
  onSubmit,
  loadLatest,
  readOnly,
  draftKey,
}: FormComponentProps<LoginValues>) {
  const form = useAppForm<LoginValues>({
    schema: loginSchema,
    defaultValues: { email: '', password: '' },
    readOnly: readOnly ?? false,
    draftKey,
    loadLatest,
    onSubmit: async (values, ctx) => {
      try {
        return await onSubmit(values, ctx);
      } catch (err) {
        // Chỉ xóa mật khẩu khi thông tin bị từ chối; lỗi hệ thống/mạng giữ nguyên để "Thử lại" gửi lại cùng dữ liệu.
        if (err instanceof AppError && CREDENTIAL_ERRORS.has(err.code)) {
          form.methods.setValue('password', '');
        }
        throw err;
      }
    },
  });
  return (
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
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  return (
    <AuthLayout title="Đăng nhập">
      <LoginForm
        onSubmit={async (values) => {
          const me = await authApi.login(values);
          void navigate(me.user.emailVerified ? safeNext(params.get('next')) : '/verify-email', {
            replace: true,
          });
        }}
      />
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
