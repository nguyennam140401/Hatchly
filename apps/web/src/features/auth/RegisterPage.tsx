import { useState } from 'react';
import { authApi, TERMS_VERSION } from '../../lib/api/endpoints/auth';
import { isChecked, minChars, objectSchema, required } from '../../lib/forms/rules';
import { useAppForm } from '../../lib/forms/useAppForm';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Button } from '../../ui/button/Button';
import { Form } from '../../ui/form/Form';
import { TextField } from '../../ui/form/fields/inputs';
import { TextLink } from '../../ui/nav/TextLink';
import { AuthLayout } from './AuthLayout';
import { TermsField } from './ConsentNotice';
import { PasswordField } from './PasswordField';
import { ProviderButtons } from './ProviderButtons';

// Đăng ký (US1, FR-001…FR-005): ô đồng ý điều khoản KHÔNG đặt sẵn (nguyên tắc VII). Phản hồi luôn là
// "Hãy kiểm tra email" – kể cả khi email đã có tài khoản (không lộ email nào đã đăng ký).

export interface RegisterValues extends Record<string, unknown> {
  displayName: string;
  email: string;
  password: string;
  acceptTerms: boolean;
}

export const registerSchema = objectSchema<RegisterValues>({
  displayName: required('Vui lòng nhập tên hiển thị.'),
  email: required('Vui lòng nhập email.'),
  password: minChars(8, 'Mật khẩu cần ít nhất 8 ký tự.'),
  acceptTerms: isChecked('Bạn cần đồng ý điều khoản để tạo tài khoản.'),
});

export function RegisterPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const form = useAppForm<RegisterValues>({
    schema: registerSchema,
    defaultValues: { displayName: '', email: '', password: '', acceptTerms: false },
    fieldOrder: ['displayName', 'email', 'password', 'acceptTerms'],
    onSubmit: async (values) => {
      await authApi.register({
        displayName: values.displayName,
        email: values.email,
        password: values.password,
        acceptTerms: true,
        termsVersion: TERMS_VERSION,
      });
      setSentTo(values.email.trim());
    },
  });

  if (sentTo !== null) {
    return (
      <AuthLayout title="Hãy kiểm tra email">
        <InlineAlert tone="info">
          Chúng tôi đã gửi thư tới <strong>{sentTo}</strong>. Mở thư và bấm liên kết để xác nhận
          email rồi bắt đầu dùng ứng dụng. Liên kết có hiệu lực 24 giờ.
        </InlineAlert>
        {resent && <p role="status">Đã gửi lại thư (nếu chưa thấy, hãy xem cả mục Thư rác).</p>}
        <Button
          variant="secondary"
          onClick={() => {
            void authApi.resend(sentTo).then(() => {
              setResent(true);
            });
          }}
        >
          Gửi lại thư
        </Button>
        <TextLink to="/login">Đã xác nhận? Đăng nhập</TextLink>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Tạo tài khoản">
      <Form form={form} submitLabel="Tạo tài khoản">
        <TextField name="displayName" label="Tên hiển thị" autoComplete="name" />
        <TextField name="email" label="Email" type="email" autoComplete="email" />
        <PasswordField
          name="password"
          label="Mật khẩu"
          autoComplete="new-password"
          help="Ít nhất 8 ký tự. Tránh mật khẩu dễ đoán như 12345678."
        />
        <TermsField />
      </Form>
      {/* 009: đăng ký bằng Google/Facebook – điều khoản được hỏi lại ở bước hoàn tất sau khi quay về. */}
      <p className="text-center text-ink-muted">hoặc</p>
      <ProviderButtons />
      <TextLink to="/login">Đã có tài khoản? Đăng nhập</TextLink>
    </AuthLayout>
  );
}
