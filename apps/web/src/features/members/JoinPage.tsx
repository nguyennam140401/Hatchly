import type { InvitationPreviewResponse, MeResponse } from '@app/shared/auth';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { AuthLayout } from '../auth/AuthLayout';
import { authApi, takeFragmentToken } from '../auth/auth-api';
import { TermsCheckbox } from '../auth/ConsentNotice';
import { PasswordField } from '../auth/PasswordField';
import { ProviderButtons } from '../auth/ProviderButtons';
import { socialApi } from '../auth/social-api';
import { ErrorNotice, styles, TextField } from '../auth/ui';

// Trang mở từ liên kết trong thư mời (009 – US3, US4). Mã nằm sau `#token=`, được xóa khỏi thanh địa
// chỉ ngay và chỉ giữ trong bộ nhớ của trang. Hiển thị theo `mode` của lời mời và theo việc người mở
// có đang đăng nhập hay không.

type State =
  | { kind: 'loading' }
  | { kind: 'invalid'; error: ApiError | null }
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
        if (err instanceof ApiError) setState({ kind: 'invalid', error: err });
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
        <p role="alert">
          <span role="img" aria-label="Cảnh báo">
            ⚠
          </span>{' '}
          {state.error?.message ??
            'Lời mời không còn hiệu lực. Hãy nhờ chủ tài khoản gửi lại lời mời.'}
        </p>
        <p>Liên kết mời chỉ dùng được một lần và có hạn 7 ngày. Hãy nhờ chủ tài khoản gửi lại.</p>
        <Link to="/login" style={styles.link}>
          Về đăng nhập
        </Link>
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
    <button
      type="button"
      style={styles.secondary}
      onClick={() => {
        // Giữ mã trong #fragment để mở lại đúng lời mời sau khi đăng xuất.
        void authApi.logout().finally(() => {
          window.location.assign(`/join#token=${token}`);
        });
      }}
    >
      Đăng xuất rồi mở lại liên kết
    </button>
  );

  // ----- Người đang đăng nhập mở liên kết -----
  if (me !== null && me.account.status !== 'unclaimed') {
    return (
      <AuthLayout title="Bạn đang thuộc một tài khoản khác">
        {intro}
        <p role="alert">
          <span role="img" aria-label="Cảnh báo">
            ⚠
          </span>{' '}
          Bạn đang đăng nhập bằng {me.user.email} và đang thuộc một tài khoản khác. Mỗi người chỉ
          thuộc một tài khoản.
        </p>
        <p>Để nhận lời mời, hãy đăng xuất rồi mở lại liên kết bằng email được mời.</p>
        {logoutAndReopen}
        <p>
          <Link to="/" style={styles.link}>
            Về trang chính
          </Link>
        </p>
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
            <p role="alert">
              <span role="img" aria-label="Cảnh báo">
                ⚠
              </span>{' '}
              Bạn đang đăng nhập bằng {me.user.email}, khác với email được mời.
            </p>
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
        <p role="alert">
          <span role="img" aria-label="Cảnh báo">
            ⚠
          </span>{' '}
          Email này đang dùng cho một tài khoản khác nên chưa tham gia được.
        </p>
        <p>Hãy nhờ {preview.inviterName} mời bạn bằng một email khác.</p>
        <Link to="/login" style={styles.link}>
          Về đăng nhập
        </Link>
      </AuthLayout>
    );
  }
  if (preview.mode === 'login_required') {
    return (
      <AuthLayout title="Hãy đăng nhập để tham gia">
        {intro}
        <p>Email này đã có tài khoản đăng nhập. Hãy đăng nhập rồi mở lại liên kết trong thư mời.</p>
        <a href={`/login?next=${encodeURIComponent('/no-account')}`} style={styles.link}>
          Đăng nhập
        </a>
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
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      {error !== null && <ErrorNotice error={error} />}
      <button
        type="button"
        style={styles.primary}
        disabled={busy}
        onClick={() => {
          setError(null);
          setBusy(true);
          socialApi
            .acceptExistingInvitation({ token })
            .then(
              () => void navigate('/', { replace: true }),
              (err: unknown) => {
                if (err instanceof ApiError) setError(err);
              },
            )
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        Tham gia {label}
      </button>
    </>
  );
}

/** `new_user`: đặt tên + mật khẩu, hoặc Google/Facebook (chỉ bấm được sau khi tích ô đồng ý). */
function NewUserForm({ token, onDone }: { token: string; onDone: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (displayName.trim() === '') local.displayName = 'Vui lòng nhập tên hiển thị.';
    if (password.length < 8) local.password = 'Mật khẩu cần ít nhất 8 ký tự.';
    if (!accepted) local.acceptTerms = 'Bạn cần đồng ý điều khoản để tham gia.';
    setFieldErrors(local);
    setError(null);
    if (Object.keys(local).length > 0) return;
    setBusy(true);
    try {
      await socialApi.invitationAccept({ token, displayName, password });
      onDone();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setFieldErrors(err.fieldErrors());
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error !== null && Object.keys(fieldErrors).length === 0 && <ErrorNotice error={error} />}
      <form onSubmit={(e) => void submit(e)} noValidate>
        <TermsCheckbox checked={accepted} onChange={setAccepted} error={fieldErrors.acceptTerms} />
        <TextField
          label="Tên hiển thị"
          value={displayName}
          onChange={setDisplayName}
          autoComplete="name"
          error={fieldErrors.displayName}
        />
        <PasswordField
          label="Đặt mật khẩu"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint="Ít nhất 8 ký tự. Tránh mật khẩu dễ đoán như 12345678."
          error={fieldErrors.password}
        />
        <button type="submit" style={styles.primary} disabled={busy}>
          {busy ? 'Đang tham gia…' : 'Tham gia'}
        </button>
      </form>
      <p style={{ textAlign: 'center', color: '#4b5563' }}>hoặc</p>
      <ProviderButtons
        disabled={!accepted}
        disabledHint="Hãy tích ô đồng ý ở trên trước khi tiếp tục với Google hoặc Facebook."
        start={(provider) => socialApi.oauthStartInvite(provider, token)}
      />
    </>
  );
}
