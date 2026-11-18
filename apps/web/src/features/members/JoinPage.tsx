import type { InvitationPreviewResponse, MeResponse } from '@app/shared/auth';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { authApi, socialApi, takeFragmentToken } from '../../lib/api/endpoints/auth';
import { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { isChecked, minChars, objectSchema, required } from '../../lib/forms/rules';
import { useAppForm } from '../../lib/forms/useAppForm';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Button } from '../../ui/button/Button';
import { Form } from '../../ui/form/Form';
import { TextField } from '../../ui/form/fields/inputs';
import { TextLink } from '../../ui/nav/TextLink';
import { AuthLayout } from '../auth/AuthLayout';
import { TermsField } from '../auth/ConsentNotice';
import { PasswordField } from '../../ui/form/fields/PasswordField';
import { ProviderButtons } from '../auth/ProviderButtons';

// Trang mở từ liên kết trong thư mời (009 – US3, US4). Mã nằm sau `#token=`, được xóa khỏi thanh địa
// chỉ ngay và chỉ giữ trong bộ nhớ của trang. Hiển thị theo `mode` của lời mời và theo việc người mở
// có đang đăng nhập hay không.

type State =
  | { kind: 'loading' }
  | { kind: 'invalid'; error: AppError | null }
  | { kind: 'ready'; token: string; preview: InvitationPreviewResponse; me: MeResponse | null };

export function JoinPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = takeFragmentToken();
    if (token === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- không có mã thì báo ngay
      setState({ kind: 'invalid', error: null });
      return;
    }
    void (async () => {
      try {
        const preview = await socialApi.invitationPreview(token);
        const me = await authApi.me({ silentAuth: true }).catch(() => null);
        setState({ kind: 'ready', token, preview, me });
      } catch (err) {
        if (err instanceof AppError) setState({ kind: 'invalid', error: err });
        else throw err;
      }
    })();
  }, []);

  if (state.kind === 'loading') {
    return (
      <AuthLayout title="Lời mời">
        <p aria-busy="true">Đang tải…</p>
      </AuthLayout>
    );
  }
  if (state.kind === 'invalid') {
    return (
      <AuthLayout title="Lời mời không còn hiệu lực">
        <InlineAlert
          tone="error"
          actions={[{ kind: 'navigate', label: 'Về đăng nhập', href: '/login' }]}
        >
          {state.error?.message ??
            'Lời mời không còn hiệu lực. Hãy nhờ chủ tài khoản gửi lại lời mời.'}
        </InlineAlert>
        <p>Liên kết mời chỉ dùng được một lần và có hạn 7 ngày. Hãy nhờ chủ tài khoản gửi lại.</p>
      </AuthLayout>
    );
  }

  const { preview, token, me } = state;
  const intro = (
    <p>
      <strong>{preview.inviterName}</strong> mời bạn tham gia {preview.accountLabel} với vai trò
      cộng tác viên, bằng email <strong>{preview.email}</strong>.
    </p>
  );
  const logoutAndReopen = (
    <div>
      <Button
        variant="secondary"
        onClick={() => {
          // Giữ mã trong #fragment để mở lại đúng lời mời sau khi đăng xuất.
          void authApi.logout().finally(() => {
            window.location.assign(`/join#token=${token}`);
          });
        }}
      >
        Đăng xuất rồi mở lại liên kết
      </Button>
    </div>
  );

  // ----- Người đang đăng nhập mở liên kết -----
  if (me !== null && me.account.status !== 'unclaimed') {
    return (
      <AuthLayout title="Bạn đang thuộc một tài khoản khác">
        {intro}
        <InlineAlert
          tone="error"
          actions={[{ kind: 'navigate', label: 'Về trang chính', href: '/' }]}
        >
          Bạn đang đăng nhập bằng {me.user.email} và đang thuộc một tài khoản khác. Mỗi người chỉ
          thuộc một tài khoản.
        </InlineAlert>
        <p>Để nhận lời mời, hãy đăng xuất rồi mở lại liên kết bằng email được mời.</p>
        {logoutAndReopen}
      </AuthLayout>
    );
  }
  if (me !== null) {
    const sameEmail = me.user.email.trim().toLowerCase() === preview.email.trim().toLowerCase();
    return (
      <AuthLayout title="Lời mời tham gia">
        {intro}
        {sameEmail ? (
          <AcceptExisting token={token} label={preview.accountLabel} />
        ) : (
          <>
            <InlineAlert
              tone="warning"
              actions={[{ kind: 'navigate', label: 'Về trang chính', href: '/' }]}
            >
              Bạn đang đăng nhập bằng {me.user.email}, khác với email được mời.
            </InlineAlert>
            {logoutAndReopen}
          </>
        )}
      </AuthLayout>
    );
  }

  // ----- Chưa đăng nhập -----
  if (preview.mode === 'in_use') {
    return (
      <AuthLayout title="Chưa tham gia được">
        {intro}
        <InlineAlert
          tone="error"
          actions={[{ kind: 'navigate', label: 'Về đăng nhập', href: '/login' }]}
        >
          Email này đang dùng cho một tài khoản khác nên chưa tham gia được.
        </InlineAlert>
        <p>Hãy nhờ {preview.inviterName} mời bạn bằng một email khác.</p>
      </AuthLayout>
    );
  }
  if (preview.mode === 'login_required') {
    return (
      <AuthLayout title="Hãy đăng nhập để tham gia">
        {intro}
        <p>Email này đã có tài khoản đăng nhập. Hãy đăng nhập rồi mở lại liên kết trong thư mời.</p>
        <TextLink to={`/login?next=${encodeURIComponent('/no-account')}`}>Đăng nhập</TextLink>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Lời mời tham gia">
      {intro}
      <NewUserForm token={token} onDone={() => void navigate('/', { replace: true })} />
    </AuthLayout>
  );
}

function AcceptExisting({ token, label }: { token: string; label: string }) {
  const navigate = useNavigate();
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      {error !== null && <ErrorNotice error={error} />}
      <div>
        <Button
          loading={busy}
          onClick={() => {
            setError(null);
            setBusy(true);
            socialApi
              .acceptExistingInvitation({ token })
              .then(
                () => void navigate('/', { replace: true }),
                (err: unknown) => {
                  if (err instanceof AppError) setError(err);
                },
              )
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          Tham gia {label}
        </Button>
      </div>
    </>
  );
}

interface JoinValues extends Record<string, unknown> {
  displayName: string;
  password: string;
  acceptTerms: boolean;
}

const joinSchema = objectSchema<JoinValues>({
  displayName: required('Vui lòng nhập tên hiển thị.'),
  password: minChars(8, 'Mật khẩu cần ít nhất 8 ký tự.'),
  acceptTerms: isChecked('Bạn cần đồng ý điều khoản để tham gia.'),
});

/** `new_user`: đặt tên + mật khẩu, hoặc Google/Facebook (chỉ bấm được sau khi tích ô đồng ý). */
function NewUserForm({ token, onDone }: { token: string; onDone: () => void }) {
  const form = useAppForm<JoinValues>({
    schema: joinSchema,
    defaultValues: { displayName: '', password: '', acceptTerms: false },
    fieldOrder: ['acceptTerms', 'displayName', 'password'],
    onSubmit: async (values) => {
      await socialApi.invitationAccept({
        token,
        displayName: values.displayName,
        password: values.password,
      });
      onDone();
    },
  });
  const accepted = form.methods.watch('acceptTerms');

  return (
    <>
      <Form form={form} submitLabel="Tham gia">
        <TermsField />
        <TextField name="displayName" label="Tên hiển thị" autoComplete="name" />
        <PasswordField
          name="password"
          label="Đặt mật khẩu"
          autoComplete="new-password"
          help="Ít nhất 8 ký tự. Tránh mật khẩu dễ đoán như 12345678."
        />
      </Form>
      <p className="text-center text-ink-muted">hoặc</p>
      <ProviderButtons
        disabled={!accepted}
        disabledHint="Hãy tích ô đồng ý ở trên trước khi tiếp tục với Google hoặc Facebook."
        start={(provider) => socialApi.oauthStartInvite(provider, token)}
      />
    </>
  );
}
