import type { OAuthPendingResponse } from '@app/shared/auth';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { PROVIDER_LABELS, socialApi } from '../../lib/api/endpoints/auth';
import { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import type { ErrorActionView } from '../../lib/catalogs/error-explanations';
import { objectSchema, required } from '../../lib/forms/rules';
import { useAppForm } from '../../lib/forms/useAppForm';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Button } from '../../ui/button/Button';
import { Form } from '../../ui/form/Form';
import { TextField } from '../../ui/form/fields/inputs';
import { TextLink } from '../../ui/nav/TextLink';
import { AuthLayout } from './AuthLayout';
import { TermsField } from './ConsentNotice';
import { PasswordField } from '../../ui/form/fields/PasswordField';
import { ProviderButtons } from './ProviderButtons';

// Trang kết quả sau khi quay về từ Google/Facebook (009 – US1, US2, US5). Đường quay về của máy chủ
// luôn chuyển tới đây KHÔNG kèm tham số; trang đọc trạng thái lượt bằng `GET /auth/oauth/pending`
// (cookie `__Host-oauth`) rồi hiện đúng bước tiếp theo. Không có mã nào nằm trên thanh địa chỉ.

type State =
  | { kind: 'loading' }
  | { kind: 'invalid'; error: AppError }
  | { kind: 'pending'; pending: OAuthPendingResponse }
  | { kind: 'check_email'; email: string | null };

const METHODS_PATH = '/settings/login-methods';
const BACK_TO_LOGIN: [ErrorActionView, ...ErrorActionView[]] = [
  { kind: 'navigate', label: 'Về đăng nhập', href: '/login' },
];

export function OAuthResultPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    socialApi.oauthPending().then(
      (pending) => {
        const { stage, purpose } = pending;
        if (purpose === 'link' || purpose === 'reauth') {
          // Quay lại trang Cách đăng nhập kèm kết quả (không có dữ liệu nhạy cảm trong trạng thái này).
          void navigate(METHODS_PATH, {
            replace: true,
            state: {
              oauthResult:
                stage === 'completed'
                  ? { ok: true, purpose, provider: pending.provider }
                  : { ok: false, message: pending.error?.message ?? null },
            },
          });
          return;
        }
        if (stage === 'signed_in' || stage === 'completed') {
          void navigate('/', { replace: true });
          return;
        }
        setState(
          stage === 'awaiting_email'
            ? { kind: 'check_email', email: null }
            : { kind: 'pending', pending },
        );
      },
      (err: unknown) => {
        if (err instanceof AppError) setState({ kind: 'invalid', error: err });
      },
    );
  }, [navigate]);

  switch (state.kind) {
    case 'loading':
      return (
        <AuthLayout title="Đang đăng nhập">
          <p aria-busy="true">Đang tải…</p>
        </AuthLayout>
      );
    case 'invalid':
      return (
        <AuthLayout title="Chưa đăng nhập được">
          <ErrorNotice error={state.error} actions={BACK_TO_LOGIN} />
        </AuthLayout>
      );
    case 'check_email':
      return <CheckEmail email={state.email} />;
    case 'pending': {
      const { pending } = state;
      const done = (email: string | null) => {
        setState({ kind: 'check_email', email });
      };
      if (pending.stage === 'failed') return <Failed pending={pending} />;
      if (pending.stage === 'needs_link_confirm') {
        return (
          <LinkConfirm
            pending={pending}
            onEmailSent={() => {
              done(null);
            }}
          />
        );
      }
      return <Signup pending={pending} onCheckEmail={done} />;
    }
  }
}

function Failed({ pending }: { pending: OAuthPendingResponse }) {
  const provider = PROVIDER_LABELS[pending.provider];
  return (
    <AuthLayout title="Chưa đăng nhập được">
      {/* Mỗi lỗi có ít nhất một hành động: thử lại bằng chính nhà cung cấp đó, hoặc dùng email. */}
      <InlineAlert
        tone="error"
        actions={[{ kind: 'navigate', label: 'Đăng nhập bằng email', href: '/login' }]}
      >
        {pending.error?.message ?? `Chưa đăng nhập được bằng ${provider}.`}
      </InlineAlert>
      <ProviderButtons only={[pending.provider]} label={(name) => `Thử lại với ${name}`} />
    </AuthLayout>
  );
}

function CheckEmail({ email }: { email: string | null }) {
  const [resent, setResent] = useState(false);
  return (
    <AuthLayout title="Hãy kiểm tra email">
      <InlineAlert tone="info">
        {email !== null ? (
          <>
            Chúng tôi đã gửi thư tới <strong>{email}</strong>.
          </>
        ) : (
          'Chúng tôi đã gửi thư cho bạn.'
        )}{' '}
        Mở thư và bấm liên kết để tiếp tục. Nếu chưa thấy, hãy xem cả mục Thư rác.
      </InlineAlert>
      {resent && <p role="status">Đã gửi lại thư.</p>}
      <div>
        <Button
          variant="secondary"
          onClick={() => {
            void socialApi.oauthLinkSendEmail().then(
              () => {
                setResent(true);
              },
              () => {
                setResent(true);
              },
            );
          }}
        >
          Gửi lại
        </Button>
      </div>
      <TextLink to="/login">Về đăng nhập</TextLink>
    </AuthLayout>
  );
}

interface SignupValues extends Record<string, unknown> {
  displayName: string;
  email: string;
  acceptTerms: boolean;
}

/** `needs_signup` (email do nhà cung cấp xác minh) và `needs_email` (tự nhập email). */
function Signup({
  pending,
  onCheckEmail,
}: {
  pending: OAuthPendingResponse;
  onCheckEmail: (email: string) => void;
}) {
  const navigate = useNavigate();
  const provider = PROVIDER_LABELS[pending.provider];
  const needsEmail = pending.emailRequired;
  const schema = useMemo(
    () =>
      objectSchema<SignupValues>({
        displayName: required('Vui lòng nhập tên hiển thị.'),
        ...(needsEmail ? { email: required('Vui lòng nhập email.') } : {}),
      }),
    [needsEmail],
  );
  const form = useAppForm<SignupValues>({
    schema,
    defaultValues: {
      displayName: pending.suggestedDisplayName ?? '',
      email: needsEmail ? (pending.suggestedEmail ?? '') : '',
      acceptTerms: false,
    },
    fieldOrder: ['displayName', 'email'],
    onSubmit: async (values) => {
      const result = await socialApi.oauthSignup({
        displayName: values.displayName,
        ...(needsEmail ? { email: values.email } : {}),
      });
      if ('status' in result) onCheckEmail(values.email.trim());
      else void navigate('/', { replace: true });
    },
  });
  // Khóa tới khi tích ô đồng ý – ô không bao giờ được đặt sẵn.
  const accepted = form.methods.watch('acceptTerms');

  return (
    <AuthLayout title="Tạo tài khoản">
      <p>
        {needsEmail
          ? `${provider} không cho chúng tôi biết email của bạn. Hãy nhập email để nhận liên kết hoàn tất đăng ký.`
          : `Bạn đang tạo tài khoản bằng ${provider} với email ${pending.suggestedEmail ?? ''}.`}
      </p>
      <Form
        form={form}
        submitLabel={needsEmail ? 'Gửi liên kết hoàn tất' : 'Tạo tài khoản'}
        {...(!accepted ? { submitLocked: 'Hãy tích ô đồng ý ở trên để tiếp tục.' } : {})}
      >
        <TextField name="displayName" label="Tên hiển thị" autoComplete="name" />
        {needsEmail && <TextField name="email" label="Email" type="email" autoComplete="email" />}
        <TermsField />
      </Form>
      <TextLink to="/login">Đã có tài khoản? Đăng nhập</TextLink>
    </AuthLayout>
  );
}

interface LinkValues extends Record<string, unknown> {
  password: string;
}

/** Email này đã có tài khoản: xác nhận bằng mật khẩu hoặc liên kết gửi qua email (US2). */
function LinkConfirm({
  pending,
  onEmailSent,
}: {
  pending: OAuthPendingResponse;
  onEmailSent: () => void;
}) {
  const navigate = useNavigate();
  const provider = PROVIDER_LABELS[pending.provider];
  const canUsePassword = pending.methods.includes('password');
  const [mailError, setMailError] = useState<AppError | null>(null);
  const hint =
    pending.hint === 'login_with_google'
      ? 'Google'
      : pending.hint === 'login_with_facebook'
        ? 'Facebook'
        : null;

  const form = useAppForm<LinkValues>({
    schema: objectSchema<LinkValues>({}),
    defaultValues: { password: '' },
    onSubmit: async (values) => {
      try {
        await socialApi.oauthLinkPassword(values.password);
        void navigate('/', { replace: true });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        form.methods.setValue('password', '');
        // Sai mật khẩu: báo ngay cạnh ô nhập; lỗi khác (bị chặn, lượt hết hạn) hiện ở hộp lỗi.
        if (err.code === 'INVALID_CREDENTIALS') {
          throw new AppError({
            kind: 'validation',
            status: err.status,
            code: err.code,
            message: err.message,
            actions: err.actions,
            fieldErrors: { password: err.message },
            support: err.support,
          });
        }
        throw err;
      }
    },
  });
  const password = form.methods.watch('password');

  async function sendEmail() {
    setMailError(null);
    try {
      await socialApi.oauthLinkSendEmail();
      onEmailSent();
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      setMailError(err);
    }
  }

  return (
    <AuthLayout title="Email này đã có tài khoản">
      <p>
        Email {pending.suggestedEmail ?? 'này'} đã có tài khoản. Hãy xác nhận đây là bạn để liên kết{' '}
        {provider} với tài khoản đó.
      </p>
      {mailError !== null && <ErrorNotice error={mailError} actions={BACK_TO_LOGIN} />}
      {canUsePassword && (
        <>
          <Form
            form={form}
            submitLabel={`Xác nhận và liên kết ${provider}`}
            {...(password === ''
              ? { submitLocked: 'Nhập mật khẩu của tài khoản để xác nhận.' }
              : {})}
            errorActions={() => BACK_TO_LOGIN}
          >
            <PasswordField
              name="password"
              label="Mật khẩu của tài khoản"
              autoComplete="current-password"
            />
          </Form>
          <p className="text-center text-ink-muted">hoặc</p>
        </>
      )}
      <div>
        <Button variant="secondary" onClick={() => void sendEmail()}>
          Gửi liên kết qua email
        </Button>
      </div>
      {hint !== null && (
        <p className="text-ink-muted">
          Hoặc đăng nhập bằng {hint} rồi thêm {provider} trong Cài đặt → Cách đăng nhập.
        </p>
      )}
      <TextLink to="/login">Về đăng nhập</TextLink>
    </AuthLayout>
  );
}
