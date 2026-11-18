import type { MeResponse } from '@app/shared/auth';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { authApi, takeFragmentToken } from '../../lib/api/endpoints/auth';
import { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { objectSchema } from '../../lib/forms/rules';
import { useAppForm } from '../../lib/forms/useAppForm';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Button } from '../../ui/button/Button';
import { Form } from '../../ui/form/Form';
import { TextField } from '../../ui/form/fields/inputs';
import { TextLink } from '../../ui/nav/TextLink';
import { AuthLayout } from './AuthLayout';

// Xác nhận email (US1, FR-008, FR-008a): mã nằm sau `#token=` (không gửi lên máy chủ web, không vào
// nhật ký truy cập) và được XÓA khỏi thanh địa chỉ trước khi gọi API. Không có mã mà đang đăng nhập
// chưa xác nhận → màn hình "Hãy xác nhận email" (gửi lại thư, sửa email, đăng xuất).

type State =
  | { kind: 'checking' }
  | { kind: 'verifying' }
  | { kind: 'invalid'; error: AppError }
  | { kind: 'pending'; me: MeResponse }
  | { kind: 'anonymous' };

export interface ChangeEmailValues extends Record<string, unknown> {
  email: string;
}

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [notice, setNotice] = useState<string | null>(null);
  const started = useRef(false);

  const changeEmail = useAppForm<ChangeEmailValues>({
    schema: objectSchema<ChangeEmailValues>({}),
    defaultValues: { email: '' },
    onSubmit: async (values) => {
      await authApi.changeEmail(values.email);
      setNotice(`Đã gửi thư xác nhận tới ${values.email.trim()}. Hãy mở thư mới để xác nhận.`);
      changeEmail.methods.reset({ email: '' });
    },
  });

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
          if (err instanceof AppError) setState({ kind: 'invalid', error: err });
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

  const resend = () =>
    authApi.resend().then(() => {
      setNotice('Đã gửi lại thư xác nhận. Nếu chưa thấy, hãy xem cả mục Thư rác.');
    });

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
          <ErrorNotice
            error={state.error}
            actions={[{ kind: 'navigate', label: 'Đăng nhập để gửi lại thư', href: '/login' }]}
          />
        </AuthLayout>
      );
    case 'anonymous':
      return (
        <AuthLayout title="Xác nhận email">
          <p>Hãy mở liên kết trong thư xác nhận, hoặc đăng nhập để gửi lại thư.</p>
          <TextLink to="/login">Đăng nhập</TextLink>
        </AuthLayout>
      );
    case 'pending':
      return (
        <AuthLayout title="Hãy xác nhận email">
          <p>
            Chúng tôi đã gửi thư tới <strong>{state.me.user.email}</strong>. Bấm liên kết trong thư
            để tiếp tục.
          </p>
          {notice !== null && <InlineAlert tone="info">{notice}</InlineAlert>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void resend()}>
              Gửi lại thư
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void authApi.logout().finally(() => void navigate('/login', { replace: true }));
              }}
            >
              Đăng xuất
            </Button>
          </div>
          <Form form={changeEmail} title="Sửa email đăng ký" submitLabel="Lưu và gửi thư mới">
            <TextField name="email" label="Email mới" type="email" autoComplete="email" />
          </Form>
        </AuthLayout>
      );
  }
}
