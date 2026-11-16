import { useState } from 'react';
import { authApi } from '../../lib/api/endpoints/auth';
import { objectSchema } from '../../lib/forms/rules';
import { useAppForm } from '../../lib/forms/useAppForm';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Form } from '../../ui/form/Form';
import { TextField } from '../../ui/form/fields/inputs';
import { TextLink } from '../../ui/nav/TextLink';
import { AuthLayout } from './AuthLayout';

// Quên mật khẩu (US5, FR-009): thông điệp LUÔN như nhau dù email có tài khoản hay không.

export interface ForgotValues extends Record<string, unknown> {
  email: string;
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useAppForm<ForgotValues>({
    schema: objectSchema<ForgotValues>({}),
    defaultValues: { email: '' },
    onSubmit: async (values) => {
      await authApi.forgot(values.email);
      setSent(true);
    },
  });

  return (
    <AuthLayout title="Quên mật khẩu">
      {sent ? (
        <InlineAlert tone="info">
          Nếu email có tài khoản, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu. Liên kết có hiệu lực
          30 phút.
        </InlineAlert>
      ) : (
        <>
          <p>Nhập email bạn dùng để đăng nhập. Chúng tôi sẽ gửi liên kết đặt lại mật khẩu.</p>
          <Form form={form} submitLabel="Gửi liên kết">
            <TextField name="email" label="Email" type="email" autoComplete="email" />
          </Form>
        </>
      )}
      <TextLink to="/login">Quay lại đăng nhập</TextLink>
    </AuthLayout>
  );
}
