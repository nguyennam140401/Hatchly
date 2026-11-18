import { useState } from 'react';
import { useNavigate } from 'react-router';
import { authApi } from '../../lib/api/endpoints/auth';
import { objectSchema } from '../../lib/forms/rules';
import { useAppForm } from '../../lib/forms/useAppForm';
import { useSession } from '../../lib/session/context';
import { ConfirmDialog } from '../../ui/alert/ConfirmDialog';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Button } from '../../ui/button/Button';
import { Form } from '../../ui/form/Form';
import { TextLink } from '../../ui/nav/TextLink';
import { AuthLayout } from './AuthLayout';
import { PasswordField } from '../../ui/form/fields/PasswordField';

// Bảo mật (US2, US5): đăng xuất, đăng xuất mọi thiết bị (có hộp xác nhận), đổi mật khẩu.

export interface ChangePasswordValues extends Record<string, unknown> {
  currentPassword: string;
  newPassword: string;
}

export function SecuritySettingsPage() {
  const navigate = useNavigate();
  const { me } = useSession();
  const [confirmAll, setConfirmAll] = useState(false);
  const [done, setDone] = useState(false);

  const form = useAppForm<ChangePasswordValues>({
    schema: objectSchema<ChangePasswordValues>({}),
    defaultValues: { currentPassword: '', newPassword: '' },
    fieldOrder: ['currentPassword', 'newPassword'],
    onSubmit: async (values) => {
      setDone(false);
      await authApi.change(values.currentPassword, values.newPassword);
      setDone(true);
    },
  });

  const logout = (all: boolean) =>
    (all ? authApi.logoutAll() : authApi.logout()).finally(
      () => void navigate('/login', { replace: true }),
    );

  return (
    <AuthLayout title="Bảo mật tài khoản">
      <p>
        Đang đăng nhập: <strong>{me.user.email}</strong>
      </p>

      <section aria-labelledby="change-password" className="flex flex-col gap-4">
        <h2 id="change-password" className="text-heading">
          Đổi mật khẩu
        </h2>
        {done && (
          <InlineAlert tone="info">
            Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.
          </InlineAlert>
        )}
        <Form form={form} submitLabel="Đổi mật khẩu">
          <PasswordField
            name="currentPassword"
            label="Mật khẩu hiện tại"
            autoComplete="current-password"
          />
          <PasswordField
            name="newPassword"
            label="Mật khẩu mới"
            autoComplete="new-password"
            help="Ít nhất 8 ký tự, không trùng email."
          />
        </Form>
      </section>

      <section aria-labelledby="sessions" className="flex flex-col gap-4">
        <h2 id="sessions" className="text-heading">
          Phiên đăng nhập
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void logout(false)}>
            Đăng xuất
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setConfirmAll(true);
            }}
          >
            Đăng xuất khỏi mọi thiết bị
          </Button>
        </div>
        <ConfirmDialog
          open={confirmAll}
          role="alertdialog"
          onOpenChange={setConfirmAll}
          title="Đăng xuất khỏi mọi thiết bị, kể cả thiết bị này?"
          confirmLabel="Đăng xuất tất cả"
          cancelLabel="Hủy"
          onConfirm={() => void logout(true)}
        />
      </section>

      <p className="flex flex-wrap gap-4">
        <TextLink to="/settings/login-methods">Cách đăng nhập</TextLink>
        <TextLink to="/">Về trang chính</TextLink>
      </p>
    </AuthLayout>
  );
}
