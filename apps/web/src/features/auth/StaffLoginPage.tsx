import type { StaffMeResponse } from '@app/shared/auth';
import { useState } from 'react';
import { authApi } from '../../lib/api/endpoints/auth';
import { objectSchema } from '../../lib/forms/rules';
import { useAppForm } from '../../lib/forms/useAppForm';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Form } from '../../ui/form/Form';
import { TextField } from '../../ui/form/fields/inputs';
import { AuthLayout } from './AuthLayout';
import { PasswordField } from '../../ui/form/fields/PasswordField';

const STAFF_ROLE_LABEL: Record<StaffMeResponse['role'], string> = {
  admin: 'Quản trị',
  support: 'Hỗ trợ',
};

// Lối vào nội bộ (US4, FR-010, FR-016): tách khỏi đăng nhập của khách hàng; phiên ngắn. Màn hình tra
// cứu hỗ trợ làm ở tính năng sau – ở đây chỉ báo đã đăng nhập.

export interface StaffLoginValues extends Record<string, unknown> {
  email: string;
  password: string;
}

export function StaffLoginPage() {
  const [staff, setStaff] = useState<StaffMeResponse | null>(null);
  const form = useAppForm<StaffLoginValues>({
    schema: objectSchema<StaffLoginValues>({}),
    defaultValues: { email: '', password: '' },
    onSubmit: async (values) => {
      try {
        setStaff(await authApi.staffLogin(values));
      } catch (err) {
        form.methods.setValue('password', '');
        throw err;
      }
    },
  });

  return (
    <AuthLayout title="Đăng nhập nội bộ">
      {staff !== null ? (
        <InlineAlert tone="info">
          {`Đã đăng nhập: ${staff.staff.displayName} (${STAFF_ROLE_LABEL[staff.role]}).`} Phiên tự
          hết sau 30 phút không dùng.
        </InlineAlert>
      ) : (
        <>
          <p>Dành cho nhân viên hỗ trợ và quản trị. Khách hàng đăng nhập ở trang chính.</p>
          <Form form={form} submitLabel="Đăng nhập">
            <TextField name="email" label="Email" type="email" autoComplete="username" />
            <PasswordField name="password" label="Mật khẩu" autoComplete="current-password" />
          </Form>
        </>
      )}
    </AuthLayout>
  );
}
